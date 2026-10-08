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
    Supports issue fetching, creation, status updating, comment creation, and search.
    """

    GRAPHQL_ENDPOINT = "https://api.linear.app/graphql"

    def __init__(self, token: Optional[str] = None):
        self.token = token or getattr(settings, "LINEAR_API_KEY", None) or os.environ.get("LINEAR_API_KEY")

    def _get_active_token(self, custom_token: Optional[str] = None) -> Optional[str]:
        if custom_token:
            return custom_token
        if self.token:
            return self.token
        try:
            from app.integrations.manager import integration_manager
            tok = integration_manager.get_custom_credential("linear", "token") or integration_manager.get_custom_credential("linear", "api_key")
            if tok:
                return tok
        except Exception:
            pass
        return getattr(settings, "LINEAR_API_KEY", None) or os.environ.get("LINEAR_API_KEY")

    def is_configured(self) -> bool:
        return bool(self._get_active_token())

    def _get_headers(self, custom_token: Optional[str] = None) -> Dict[str, str]:
        token = self._get_active_token(custom_token)
        if not token:
            return {}
        token = str(token).strip()
        if token.startswith("Bearer "):
            token = token[7:].strip()
        # Linear Personal API keys start with 'lin_api_' and MUST NOT have 'Bearer ' prepended.
        # OAuth tokens (e.g. 'lin_oauth_') or standard JWTs use 'Bearer <token>'.
        if token.startswith("lin_api_"):
            auth_val = token
        else:
            auth_val = f"Bearer {token}"
        return {
            "Authorization": auth_val,
            "Content-Type": "application/json",
        }

    async def get_issue(self, issue_key: str, custom_token: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Fetches an issue by key (e.g., 'PD-1236', 'ENG-402') or Linear UUID from Linear's GraphQL API.
        Returns None if not configured or if the ticket cannot be found.
        """
        headers = self._get_headers(custom_token)
        if not headers:
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
                    headers=headers
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
        headers = self._get_headers(custom_token)
        if not headers:
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
                    headers=headers
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
        headers = self._get_headers(custom_token)
        if not headers:
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
                    headers=headers
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
        Searches Linear issues matching a query string using Linear's canonical searchIssues GraphQL query.
        """
        headers = self._get_headers(custom_token)
        if not headers:
            return []

        query = """
        query SearchIssues($term: String!) {
          searchIssues(term: $term, first: 10) {
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
                    json={"query": query, "variables": {"term": query_str}},
                    headers=headers
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if "data" in data:
                        if data["data"].get("searchIssues"):
                            return data["data"]["searchIssues"].get("nodes", [])
                        if data["data"].get("issueSearch"):
                            return data["data"]["issueSearch"].get("nodes", [])
                    if "errors" in data:
                        logger.warning(f"Linear search error: {data['errors']}")
        except Exception as e:
            logger.warning(f"Error searching Linear issues: {e}")

        return []

    async def list_teams(self, custom_token: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Lists available Linear teams, their keys, workflow states, and labels.
        """
        headers = self._get_headers(custom_token)
        if not headers:
            return []

        query = """
        query ListTeams {
          teams {
            nodes {
              id
              name
              key
              description
              states {
                nodes {
                  id
                  name
                  color
                  type
                }
              }
              labels {
                nodes {
                  id
                  name
                  color
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
                    json={"query": query},
                    headers=headers
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if "data" in data and data["data"].get("teams"):
                        return data["data"]["teams"].get("nodes", [])
        except Exception as e:
            logger.warning(f"Error fetching Linear teams: {e}")

        return []

    async def create_issue(
        self,
        title: str,
        team_id_or_key: str,
        description: Optional[str] = None,
        priority: Optional[int] = 0,
        state_id: Optional[str] = None,
        custom_token: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Creates a new Linear issue. Resolves team key (e.g. 'PD') and state names automatically.
        """
        headers = self._get_headers(custom_token)
        if not headers:
            return {"success": False, "error": "Linear integration is not configured"}

        team_id = team_id_or_key
        teams = await self.list_teams(custom_token=custom_token)
        matched_team = None
        for t in teams:
            if t["id"] == team_id_or_key or t["key"].upper() == team_id_or_key.strip().upper() or t["name"].lower() == team_id_or_key.strip().lower():
                team_id = t["id"]
                matched_team = t
                break

        resolved_state_id = state_id
        if matched_team and state_id:
            for s in matched_team.get("states", {}).get("nodes", []):
                if s["id"] == state_id or s["name"].lower() == state_id.strip().lower():
                    resolved_state_id = s["id"]
                    break

        input_payload: Dict[str, Any] = {
            "title": title,
            "teamId": team_id,
        }
        if description:
            input_payload["description"] = description
        if priority is not None:
            input_payload["priority"] = priority
        if resolved_state_id:
            input_payload["stateId"] = resolved_state_id

        mutation = """
        mutation CreateIssue($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue {
              id
              identifier
              title
              url
              priority
              priorityLabel
              state {
                id
                name
                color
              }
              team {
                id
                key
                name
              }
            }
          }
        }
        """
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    self.GRAPHQL_ENDPOINT,
                    json={"query": mutation, "variables": {"input": input_payload}},
                    headers=headers
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if "data" in data and data["data"].get("issueCreate"):
                        return data["data"]["issueCreate"]
                    if "errors" in data:
                        return {"success": False, "error": str(data["errors"])}
                return {"success": False, "error": f"Linear API returned HTTP {resp.status_code}"}
        except Exception as e:
            logger.warning(f"Error creating Linear issue: {e}")
            return {"success": False, "error": str(e)}


linear_client = LinearClient()
