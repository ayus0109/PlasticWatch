"""Mapping between stored media paths and files on disk (CLAUDE.md §3: local disk).

Stored/API paths are always public, URL-style: "uploads/<sub>/<name>.jpg". The file
lives at UPLOAD_DIR/<sub>/<name>.jpg, wherever UPLOAD_DIR points. Keeping the two
apart means a relative UPLOAD_DIR in docker and an absolute one in tests produce the
same stored paths, and the API never leaks a filesystem path.
"""

from __future__ import annotations

from pathlib import Path

from app.config import get_settings

PUBLIC_PREFIX = "uploads"


def upload_root() -> Path:
    return Path(get_settings().UPLOAD_DIR)


def to_public(fs_path: Path) -> str:
    rel = Path(fs_path).resolve().relative_to(upload_root().resolve())
    return f"{PUBLIC_PREFIX}/{rel.as_posix()}"


def to_fs(public_path: str) -> Path:
    """Resolve a public path to a file under UPLOAD_DIR. Rejects path traversal."""
    prefix = PUBLIC_PREFIX + "/"
    if not public_path.startswith(prefix):
        raise ValueError(f"not a media path: {public_path!r}")
    root = upload_root().resolve()
    target = (root / public_path[len(prefix):]).resolve()
    if not target.is_relative_to(root):
        raise ValueError("path escapes the upload directory")
    return target


def annotated_for(image_public_path: str) -> str | None:
    """The detector's annotated image for a stored report image, if it was written.

    The detector names it after the source image (SPEC §6 annotated_jpg_path);
    §7 has no column for it, so it is derived rather than stored.
    """
    candidate = f"{PUBLIC_PREFIX}/annotated/{Path(image_public_path).stem}.jpg"
    try:
        return candidate if to_fs(candidate).is_file() else None
    except ValueError:
        return None
