import asyncio
import json
import pytest
from pathlib import Path
import httpx

from app.main import app
from app.db.session import async_session_factory
from app.db.models import TaskModel
from app.core.sandboxes.notebook_runner import notebook_runner, NotebookKernelSession


@pytest.mark.asyncio
async def test_notebook_kernel_session_execution(tmp_path):
    ws = tmp_path / "nb_kernel_ws"
    ws.mkdir(parents=True, exist_ok=True)

    session = NotebookKernelSession(
        task_id="task-test-nb-kernel",
        file_path="test_notebook.ipynb",
        workspace_path=ws
    )

    started = await session.start()
    assert started is True
    assert session.process is not None
    assert session.process.pid > 0

    # 1. Execute simple print statement (stdout stream)
    res1 = await session.execute_cell("print('HELLO_NOTEBOOK_WORLD')")
    assert res1["ok"] is True
    assert res1["execution_count"] == 1
    outputs1 = res1["outputs"]
    assert any("HELLO_NOTEBOOK_WORLD" in "".join(o.get("text", [])) for o in outputs1 if o.get("output_type") == "stream")

    # 2. Variable state persistence between cells
    res2 = await session.execute_cell("x_var = 42\ny_var = 58")
    assert res2["ok"] is True
    assert res2["execution_count"] == 2

    # 3. Expression evaluation (execute_result)
    res3 = await session.execute_cell("x_var + y_var")
    assert res3["ok"] is True
    assert res3["execution_count"] == 3
    outputs3 = res3["outputs"]
    exec_res = next((o for o in outputs3 if o.get("output_type") == "execute_result"), None)
    assert exec_res is not None
    assert exec_res["data"]["text/plain"] == "100"

    # 4. Error traceback
    res4 = await session.execute_cell("1 / 0")
    assert res4["ok"] is False
    outputs4 = res4["outputs"]
    err_out = next((o for o in outputs4 if o.get("output_type") == "error"), None)
    assert err_out is not None
    assert err_out["ename"] == "ZeroDivisionError"

    await session.stop()


@pytest.mark.asyncio
async def test_notebook_runner_manager_and_disk_persistence(tmp_path):
    ws = tmp_path / "nb_runner_ws"
    ws.mkdir(parents=True, exist_ok=True)

    nb_path = ws / "pipeline.ipynb"
    initial_nb = {
        "cells": [
            {
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "source": ["dataset_size = 5000\n", "print(f'Configured size: {dataset_size}')\n"],
                "outputs": []
            },
            {
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "source": ["dataset_size * 2\n"],
                "outputs": []
            }
        ],
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}
        },
        "nbformat": 4,
        "nbformat_minor": 2
    }
    nb_path.write_text(json.dumps(initial_nb, indent=2))

    task_id = "task-nb-runner-test"

    # Execute cell 0
    res0 = await notebook_runner.execute_cell(
        task_id=task_id,
        file_path="pipeline.ipynb",
        workspace_path=ws,
        cell_index=0
    )
    assert res0["ok"] is True
    assert res0["execution_count"] == 1

    # Verify disk persistence
    disk_data = json.loads(nb_path.read_text())
    assert disk_data["cells"][0]["execution_count"] == 1
    assert len(disk_data["cells"][0]["outputs"]) > 0

    # Execute all remaining
    all_res = await notebook_runner.execute_all_cells(
        task_id=task_id,
        file_path="pipeline.ipynb",
        workspace_path=ws
    )
    assert all_res["ok"] is True
    assert all_res["executed"] == 2

    # Verify cell 1 on disk
    disk_data2 = json.loads(nb_path.read_text())
    assert disk_data2["cells"][1]["execution_count"] == 3
    assert disk_data2["cells"][1]["outputs"][0]["data"]["text/plain"] == "10000"

    await notebook_runner.cleanup_task(task_id)


@pytest.mark.asyncio
async def test_notebook_api_endpoints(tmp_path):
    ws = tmp_path / "nb_api_ws"
    ws.mkdir(parents=True, exist_ok=True)

    task_id = "task-nb-api-test"
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            session_key="test-key-api",
            title="Notebook API Test",
            persona="IssueResolver",
            status="RUNNING",
            workspace_path=str(ws)
        )
        session.add(task)
        await session.commit()

    nb_file = ws / "api_test.ipynb"
    initial_nb = {
        "cells": [
            {
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "source": ["multiplier = 7\n", "multiplier * 6\n"],
                "outputs": []
            }
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 2
    }
    nb_file.write_text(json.dumps(initial_nb))

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Execute cell via POST
        res = await client.post(
            f"/api/tasks/{task_id}/notebooks/execute-cell",
            json={"path": "api_test.ipynb", "cell_index": 0}
        )
        assert res.status_code == 200
        data = res.json()
        assert data["ok"] is True
        assert data["execution_count"] == 1
        assert any(o.get("data", {}).get("text/plain") == "42" for o in data["outputs"])

        # 2. Restart kernel via POST
        res_restart = await client.post(
            f"/api/tasks/{task_id}/notebooks/restart",
            json={"path": "api_test.ipynb", "clear_outputs": True}
        )
        assert res_restart.status_code == 200
        assert res_restart.json()["ok"] is True

        # Verify outputs cleared on disk
        saved_nb = json.loads(nb_file.read_text())
        assert saved_nb["cells"][0]["outputs"] == []

        # 3. Save modified notebook structure via PUT
        modified_nb = dict(saved_nb)
        modified_nb["cells"].append({
            "cell_type": "markdown",
            "metadata": {},
            "source": ["## Conclusion and Summary\n"]
        })
        res_save = await client.put(
            f"/api/tasks/{task_id}/notebooks/save",
            json={"path": "api_test.ipynb", "notebook": modified_nb}
        )
        assert res_save.status_code == 200
        assert res_save.json()["ok"] is True

        # Verify 2 cells on disk
        reloaded = json.loads(nb_file.read_text())
        assert len(reloaded["cells"]) == 2
        assert reloaded["cells"][1]["cell_type"] == "markdown"

    await notebook_runner.cleanup_task(task_id)
