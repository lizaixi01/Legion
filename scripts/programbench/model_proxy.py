"""Compatibility entry; the model-only transport is shared execution infrastructure."""
from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).resolve().parents[1] / 'runtime/model_proxy.py'), run_name='__main__')
