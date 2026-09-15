import logging
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException, Query, Body
from pydantic import BaseModel, Field

from app.integrations.linear_client import linear_client

logger = logging.getLogger("cyclode.api.linear")
router = APIRouter(prefix="/api/linear", tags=["Linear"])


class UpdateStatusRequest(BaseModel):
    state_id: str = Field(..., description="Target Linear state ID, e.g. 'st-in-progress' or UUID")


class PostCommentRequest(BaseModel):
    body: str = Field(..., description="Markdown comment content to post to the Linear issue")


@router.get("/issues/{issue_key}")
async def get_linear_issue(issue_key: str):
    """
    Fetches full Linear issue details including comments, labels, status workflow, and assignee.
    """
    try:
        issue = await linear_client.get_issue(issue_key)
        if not issue:
            raise HTTPException(status_code=404, detail=f"Linear issue {issue_key} not found")
        return issue
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching Linear issue {issue_key}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch Linear issue: {str(e)}")


@router.post("/issues/{issue_key}/status")
async def update_linear_issue_status(issue_key: str, payload: UpdateStatusRequest):
    """
    Updates the state/status of a Linear issue.
    """
    try:
        # First retrieve issue to get id if issue_key is an identifier like PD-1236
        issue = await linear_client.get_issue(issue_key)
        issue_id = issue.get("id", issue_key)
        result = await linear_client.update_issue_status(issue_id, payload.state_id)
        return result
    except Exception as e:
        logger.error(f"Error updating status for Linear issue {issue_key}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update issue status: {str(e)}")


@router.post("/issues/{issue_key}/comment")
async def post_linear_issue_comment(issue_key: str, payload: PostCommentRequest):
    """
    Posts a new comment to a Linear issue.
    """
    try:
        issue = await linear_client.get_issue(issue_key)
        issue_id = issue.get("id", issue_key)
        result = await linear_client.post_comment(issue_id, payload.body)
        return result
    except Exception as e:
        logger.error(f"Error posting comment to Linear issue {issue_key}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to post comment: {str(e)}")


@router.get("/search")
async def search_linear_issues(q: str = Query(..., min_length=1, description="Search term or issue key")):
    """
    Searches Linear issues matching the search query.
    """
    try:
        results = await linear_client.search_issues(q)
        return {"query": q, "results": results}
    except Exception as e:
        logger.error(f"Error searching Linear issues: {e}")
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")
