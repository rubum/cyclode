from typing import Optional, Dict, Any, List
from app.config import settings


class AppSignalClient:
    def __init__(self, api_key: Optional[str] = None, app_id: Optional[str] = None):
        self.api_key = api_key or settings.APPSIGNAL_API_KEY
        self.app_id = app_id or settings.APPSIGNAL_APP_ID

    def is_configured(self) -> bool:
        return bool(self.api_key and self.app_id)

    def parse_exception_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extracts structured exception info from AppSignal webhook payload.
        """
        marker = payload.get("marker", {})
        incident = payload.get("incident", {})
        
        exception_name = incident.get("exception_name") or payload.get("exception") or "UnknownException"
        error_message = incident.get("error_message") or payload.get("message") or "An error occurred"
        backtrace = incident.get("backtrace") or payload.get("backtrace") or []
        repository = incident.get("repository") or payload.get("repository") or "backend"
        
        # Extract suspect file and line number
        suspect_file = None
        suspect_line = None
        if isinstance(backtrace, list) and backtrace:
            first_frame = str(backtrace[0])
            if ":" in first_frame:
                parts = first_frame.split(":")
                suspect_file = parts[0]
                if len(parts) > 1 and parts[1].isdigit():
                    suspect_line = int(parts[1])

        return {
            "exception_name": exception_name,
            "error_message": error_message,
            "backtrace": backtrace,
            "repository": repository,
            "suspect_file": suspect_file,
            "suspect_line": suspect_line,
            "count": incident.get("count", 1),
            "severity": incident.get("severity", "error")
        }


appsignal_client = AppSignalClient()
