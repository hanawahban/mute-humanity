"""One reader module per dataset. Each exposes:

    read_years(ds_cfg, record_id, record_cfg, years) -> {year: YearResult}

YearResult = {"grids": {layer_id: (rows, cols) float array, NaN = null},
              "planned": int, "used": int, "partial": bool,
              "source": short name used for that year}

Readers other than omno2d are added one at a time, after the first granule of
the dataset has been inspected and confirmed (see pipeline.peek.py).
"""
import importlib


def get(name):
    try:
        return importlib.import_module(f"{__package__}.{name}")
    except ModuleNotFoundError as e:
        if e.name != f"{__package__}.{name}":
            raise
        raise NotImplementedError(
            f"reader '{name}' not written yet: inspect a granule first "
            f"(python -m pipeline.peek {name}) and confirm the structure") from None
