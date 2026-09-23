from __future__ import annotations

import re
from typing import Any

import pandas as pd


def numeric_candidates(frame: pd.DataFrame) -> list[str]:
    candidates: list[str] = []
    for column in frame.columns:
        if column.startswith("_"):
            continue
        converted = pd.to_numeric(frame[column], errors="coerce")
        if converted.notna().mean() >= 0.6:
            candidates.append(column)
    return candidates


def dimension_candidates(frame: pd.DataFrame) -> list[str]:
    return [
        column
        for column in frame.columns
        if not column.startswith("_") and column not in numeric_candidates(frame)
    ]


def apply_filters(frame: pd.DataFrame, filters: dict[str, list[Any]]) -> pd.DataFrame:
    result = frame.copy()
    for column, selected in filters.items():
        if selected:
            result = result[result[column].astype(str).isin({str(item) for item in selected})]
    return result


def summarize(frame: pd.DataFrame, dimension: str, metric: str, aggregation: str) -> pd.DataFrame:
    working = frame[[dimension, metric]].copy()
    working[metric] = pd.to_numeric(working[metric], errors="coerce")
    working = working.dropna(subset=[metric])
    mapping = {"求和": "sum", "平均值": "mean", "计数": "count", "最大值": "max", "最小值": "min"}
    result = working.groupby(dimension, dropna=False)[metric].agg(mapping[aggregation]).reset_index()
    return result.sort_values(metric, ascending=False).reset_index(drop=True)


def interpret_question(question: str, frame: pd.DataFrame) -> dict[str, Any]:
    text = question.strip().lower()
    metrics = numeric_candidates(frame)
    dimensions = dimension_candidates(frame)
    metric = next((column for column in metrics if column.lower() in text), metrics[0] if metrics else None)
    preferred_dimension_words = ("月份", "日期", "时间", "车型", "版本", "区域", "门店", "配置")
    dimension = next((column for word in preferred_dimension_words for column in dimensions if word in column and word in text), None)
    if dimension is None:
        dimension = next((column for column in dimensions if column.lower() in text), dimensions[0] if dimensions else None)
    filters: dict[str, list[str]] = {}
    for column in dimensions:
        values = frame[column].dropna().astype(str).unique()
        matches = [
            value for value in values
            if value.strip().lower() != column.strip().lower() and value.lower() in text
        ]
        if matches:
            filters[column] = matches[:20]
    recent = re.search(r"最近\s*(\d+)\s*个?月", text)
    return {"metric": metric, "dimension": dimension, "filters": filters, "recent_months": int(recent.group(1)) if recent else None}
