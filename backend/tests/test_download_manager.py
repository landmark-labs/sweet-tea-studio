import pathlib

import pytest

from app.services import download_manager as dm


def _make_job(tmp_path: pathlib.Path, url: str = "https://example.com/file.bin") -> dm.DownloadJob:
    target_path = tmp_path / "checkpoints" / "file.bin"
    target_path.parent.mkdir(parents=True, exist_ok=True)
    return dm.DownloadJob(
        job_id="job123",
        url=url,
        target_folder="checkpoints",
        target_path=target_path,
        filename=target_path.name,
    )


def test_extract_hf_file_info_from_url_blob():
    info = dm._extract_hf_file_info_from_url(
        "https://huggingface.co/org/repo/blob/main/subdir/model.gguf"
    )
    assert info == ("org/repo", "main", "subdir/model.gguf")


def test_extract_hf_file_info_from_url_resolve():
    info = dm._extract_hf_file_info_from_url(
        "https://huggingface.co/org/repo/resolve/main/model.safetensors"
    )
    assert info == ("org/repo", "main", "model.safetensors")


def test_download_huggingface_repo_id_uses_hf_hub(tmp_path, monkeypatch):
    manager = dm.DownloadManager()
    job = _make_job(tmp_path, "org/repo")

    calls = []

    def fake_hf_hub(download_job, repo_id, token):
        calls.append((download_job.job_id, repo_id, token))

    monkeypatch.setattr(manager, "_download_with_hf_hub", fake_hf_hub)
    monkeypatch.setattr(manager, "_download_single_hf_file", lambda *args, **kwargs: pytest.fail("Should not download single file"))

    manager._download_huggingface(job)

    assert calls == [("job123", "org/repo", None)]


def test_download_huggingface_file_url_uses_hf_hub_download(tmp_path, monkeypatch):
    manager = dm.DownloadManager()
    job = _make_job(tmp_path, "https://huggingface.co/org/repo/blob/main/model.gguf")

    calls = []

    def fake_single_file(download_job, repo_id, filename, revision="main", token=None):
        calls.append((download_job.job_id, repo_id, filename, revision, token))

    monkeypatch.setattr(manager, "_download_single_hf_file", fake_single_file)
    monkeypatch.setattr(manager, "_download_with_hf_hub", lambda *args, **kwargs: pytest.fail("Should not route file URL to repo snapshot"))
    monkeypatch.setattr(manager, "_download_with_aria2c", lambda *args, **kwargs: pytest.fail("Should not use aria2c for Hugging Face"))

    manager._download_huggingface(job)

    assert calls == [("job123", "org/repo", "model.gguf", "main", None)]


def test_download_civitai_with_model_version_query_uses_api_url(tmp_path, monkeypatch):
    manager = dm.DownloadManager()
    job = _make_job(tmp_path, "https://civitai.com/models/12345/model-name?modelVersionId=67890")

    captured = {}

    monkeypatch.setattr("app.services.app_settings.get_civitai_api_key", lambda: "secret-token")

    def fake_download_with_progress(download_job, url, headers=None):
        captured["url"] = url

    monkeypatch.setattr(manager, "_download_with_progress", fake_download_with_progress)

    manager._download_civitai(job)

    assert captured["url"] == "https://civitai.com/api/download/models/67890?token=secret-token"


def test_download_civitai_model_page_resolves_latest_version_via_api(tmp_path, monkeypatch):
    manager = dm.DownloadManager()
    job = _make_job(tmp_path, "https://civitai.com/models/12345/model-name")

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"modelVersions": [{"id": 99999}]}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url, headers=None):
            assert url == "https://civitai.com/api/v1/models/12345"
            assert headers == {"Authorization": "Bearer secret-token"}
            return FakeResponse()

    captured = {}

    monkeypatch.setattr("app.services.app_settings.get_civitai_api_key", lambda: "secret-token")
    monkeypatch.setattr(dm.httpx, "Client", FakeClient)
    monkeypatch.setattr(manager, "_download_with_progress", lambda download_job, url, headers=None: captured.setdefault("url", url))

    manager._download_civitai(job)

    assert captured["url"] == "https://civitai.com/api/download/models/99999?token=secret-token"


def test_download_generic_falls_back_to_aria2c(tmp_path, monkeypatch):
    manager = dm.DownloadManager()
    job = _make_job(tmp_path, "https://example.com/model.bin")

    monkeypatch.setattr(manager, "_download_with_progress", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("http failed")))
    monkeypatch.setattr(dm, "_get_aria2c_path", lambda: pathlib.Path("aria2c"))
    monkeypatch.setattr(dm, "_download_aria2c", lambda: None)

    called = {}

    def fake_aria2(download_job, url, headers=None):
        called["url"] = url
        return True

    monkeypatch.setattr(manager, "_download_with_aria2c", fake_aria2)

    manager._download_generic(job)

    assert called["url"] == "https://example.com/model.bin"
