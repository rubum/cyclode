import logging
import os
import re
from typing import Dict, Any, Optional, List
import httpx

from app.config import settings

logger = logging.getLogger("cyclode.integrations.linear")


class LinearClient:
    """
    Client for interacting with Linear's GraphQL API.
    Supports issue fetching, status updating, comment creation, and search.
    """

    GRAPHQL_ENDPOINT = "https://api.linear.app/graphql"

    def __init__(self, token: Optional[str] = None):
        self.token = token or getattr(settings, "LINEAR_API_KEY", None) or os.environ.get("LINEAR_API_KEY")

    def is_configured(self) -> bool:
        return bool(self.token or getattr(settings, "LINEAR_API_KEY", None) or os.environ.get("LINEAR_API_KEY"))

    def _get_active_token(self, custom_token: Optional[str] = None) -> Optional[str]:
        return custom_token or self.token or getattr(settings, "LINEAR_API_KEY", None) or os.environ.get("LINEAR_API_KEY")

    async def get_issue(self, issue_key: str, custom_token: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Fetches an issue by key (e.g., 'PD-1236', 'ENG-402') or Linear UUID from Linear's GraphQL API.
        Returns None if not configured or if the ticket cannot be found.
        """
        token = self._get_active_token(custom_token)
        if not token:
            logger.debug("Linear token is not configured.")
            return None

        clean_key = issue_key.strip().upper()
        query = """
        query IssueQuery($id: String!) {
          issue(id: $id) {
            id
            identifier
            title
            description
            priority
            priorityLabel
            url
            createdAt
            updatedAt
            state {
              id
              name
              color
              type
            }
            assignee {
              id
              name
              displayName
              avatarUrl
              email
            }
            creator {
              id
              name
              displayName
              avatarUrl
            }
            team {
              id
              name
              key
              states {
                nodes {
                  id
                  name
                  color
                  type
                }
              }
            }
            project {
              id
              name
            }
            labels {
              nodes {
                id
                name
                color
              }
            }
            comments {
              nodes {
                id
                body
                createdAt
                user {
                  id
                  name
                  displayName
                  avatarUrl
                }
              }
            }
          }
        }
        """
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    self.GRAPHQL_ENDPOINT,
                    json={"query": query, "variables": {"id": clean_key}},
                    headers={"Authorization": token if token.startswith("Bearer ") else f"Bearer {token}"}
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if "data" in data and data["data"].get("issue"):
                        return data["data"]["issue"]
                    if "errors" in data:
                        logger.warning(f"Linear GraphQL error fetching {clean_key}: {data['errors']}")
                else:
                    logger.warning(f"Linear API returned HTTP {resp.status_code} for {clean_key}")
        except Exception as e:
            logger.warning(f"Error querying Linear API for {clean_key}: {e}")

        return None

    async def update_issue_status(self, issue_id: str, state_id: str, custom_token: Optional[str] = None) -> Dict[str, Any]:
        """
        Updates the workflow status (stateId) of a Linear issue.
        """
        token = self._get_active_token(custom_token)
        if not token:
            return {"success": False, "error": "Linear integration is not configured"}

        mutation = """
        mutation UpdateIssueState($id: String!, $stateId: String!) {
          issueUpdate(id: $id, input: { stateId: $stateId }) {
            success
            issue {
              id
              identifier
              state {
                id
                name
                color
                type
              }
            }
          }
        }
        """
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    self.GRAPHQL_ENDPOINT,
                    json={"query": mutation, "variables": {"id": issue_id, "stateId": state_id}},
                    headers={"Authorization": token if token.startswith("Bearer ") else f"Bearer {token}"}
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if "data" in data and data["data"].get("issueUpdate"):
                        return data["data"]["issueUpdate"]
                    if "errors" in data:
                        return {"success": False, "error": str(data["errors"])}
                return {"success": False, "error": f"Linear API returned HTTP {resp.status_code}"}
        except Exception as e:
            logger.warning(f"Error updating Linear issue state: {e}")
            return {"success": False, "error": str(e)}

    async def post_comment(self, issue_id: str, body: str, custom_token: Optional[str] = None) -> Dict[str, Any]:
        """
        Creates a comment on a Linear issue.
        """
        token = self._get_active_token(custom_token)
        if not token:
            return {"success": False, "error": "Linear integration is not configured"}

        mutation = """
        mutation CreateComment($issueId: String!, $body: String!) {
          commentCreate(input: { issueId: $issueId, body: $body }) {
            success
            comment {
              id
              body
              createdAt
              user {
                id
                name
                displayName
                avatarUrl
              }
            }
          }
        }
        """
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    self.GRAPHQL_ENDPOINT,
                    json={"query": mutation, "variables": {"issueId": issue_id, "body": body}},
                    headers={"Authorization": token if token.startswith("Bearer ") else f"Bearer {token}"}
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if "data" in data and data["data"].get("commentCreate"):
                        return data["data"]["commentCreate"]
                    if "errors" in data:
                        return {"success": False, "error": str(data["errors"])}
                return {"success": False, "error": f"Linear API returned HTTP {resp.status_code}"}
        except Exception as e:
            logger.warning(f"Error posting comment to Linear: {e}")
            return {"success": False, "error": str(e)}

    async def search_issues(self, query_str: str, custom_token: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Searches Linear issues matching a query string.
        """
        token = self._get_active_token(custom_token)
        if not token:
            return []

        query = """
        query SearchIssues($query: String!) {
          issueSearch(query: $query, first: 10) {
            nodes {
              id
              identifier
              title
              priority
              priorityLabel
              url
              state {
                id
                name
                color
              }
            }
          }
        }
        """
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    self.GRAPHQL_ENDPOINT,
                    json={"query": query, "variables": {"query": query_str}},
                    headers={"Authorization": token if token.startswith("Bearer ") else f"Bearer {token}"}
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if "data" in data and data["data"].get("issueSearch"):
                        return data["data"]["issueSearch"].get("nodes", [])
        except Exception as e:
            logger.warning(f"Error searching Linear issues: {e}")

        return []


linear_client = LinearClient()
