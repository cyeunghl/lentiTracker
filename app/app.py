"""WSGI entry point for running the Lentivirus tracker."""
from __future__ import annotations

import os
import sys


if __package__ in {None, ""}:
    # Allow executing ``python app/app.py`` by ensuring the project root is on
    # ``sys.path`` before importing the Flask factory from the package.
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if project_root not in sys.path:
        sys.path.insert(0, project_root)

from app import create_app  # type: ignore  # pylint: disable=wrong-import-position

app = create_app()


if __name__ == "__main__":
    app.run(debug=True)
