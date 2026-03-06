# Connector Manager UI

React-based UI for managing and testing connectors.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start development server:**
   ```bash
   npm run dev
   ```

   The app will be available at http://localhost:3000

3. **Make sure the backend API is running on port 8000:**
   ```bash
   cd ..
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

## Features

### Chat Tab
- Generate connectors using AI by describing what you need
- Sends requests to `/chat` endpoint
- Validates and fixes JSON automatically

### Storage Tab
- Save connector JSON to storage API
- JSON editor with syntax highlighting
- Sends to `/add-to-storage` endpoint

### Validation Tab
- Validate connector JSON using engine.py validators
- Enter filename to fetch and validate from storage
- Uses `/validate-connector/{filename}` endpoint

### Run Engine Tab
- Execute connectors in Docker using engine.py
- Fetch connector from storage and run it
- View execution results, stdout, stderr
- Uses `/run-engine/{filename}` endpoint

## API Configuration

The Vite proxy is configured to forward `/api/*` requests to `http://localhost:8000`

## Build for Production

```bash
npm run build
```

The build output will be in the `dist` folder.
