# Lentivirus Production Tracker

This project provides a full-stack web application for tracking lentivirus production workflows, including seeding, plasmid preparation, transfection, media changes, harvest, and titer analysis.

## Features

- **Experiment seeding records** with automatic seeding volume calculations based on culture vessel surface area.
- **Lentivirus preparation management** with printable labels and persistent experiment progress.
- **Transfection scaling assistant** that linearly adjusts Opti-MEM, X-tremeGENE 9, and plasmid masses for any supported vessel size.
- **Media change & harvest logging** with quick label printing utilities.
- **Titer setup and results recording** with automatic MOI and viral titer calculations, averaged output, and clipboard-ready summaries.
- **Interactive MOI vs. percent infected chart** powered by Chart.js.
- **Bulk experiment table view** with double-click-to-edit support.
- **SQLite-backed persistence** managed through SQLAlchemy.

## Getting Started

1. Create a virtual environment and install dependencies:

   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. Run the development server:

   ```bash
   python app/app.py
   ```

3. Navigate to `http://127.0.0.1:5000` to use the tracker.


The database (`lenti_tracker.db`) will be created automatically on first run in the project root.
=======
The SQLite database (`app/instance/lenti_tracker.db`) is created automatically the first time the app runs. Existing installations are upgraded in-place—the server migrates any legacy `app/lenti_tracker.db` file into the new location and then inspects the `experiments` table on startup to transparently add any missing columns that newer builds require.
>>>>>>> codex/build-full-stack-lentivirus-production-tracker-0rg9pw

## Tech Stack

- **Backend:** Flask, SQLAlchemy, Flask-Migrate
- **Frontend:** Bootstrap 5, Chart.js, vanilla JavaScript
- **Database:** SQLite (configured via SQLAlchemy)

## Project Structure

```
app/
├── app.py               # Flask application, models, and API routes
├── static/
│   ├── css/styles.css   # Custom styles
│   └── js/app.js        # Front-end logic and API integration
└── templates/index.html # Main UI layout
requirements.txt         # Python dependencies
```

## Development Notes

- All API routes respond with JSON and are consumed by the single-page UI.
- Calculations follow the ratios defined in the workflow description and scale with vessel surface area.
- Use the **Refresh Records** button to reload experiment data across open sessions.

Feel free to adapt the schema or extend the UI to match lab-specific workflows or additional quality-control steps.
