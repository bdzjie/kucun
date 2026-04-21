"""
tests/conftest.py
pytest configuration for OpenClaw workspace tests

Provides shared fixtures for:
- Skill testing (unit + e2e)
- API mocking
- Fixture composition
"""

import pytest
import sys
import os
from pathlib import Path

# ─── Paths ────────────────────────────────────────────────────────────────────

WORKSPACE = Path(r'C:\Users\Administrator\.openclaw\workspace')
SKILLS_DIR = WORKSPACE / 'skills'
MODULES_DIR = WORKSPACE / 'modules'
STATE_DIR = Path.home() / '.openclaw'

# Add modules to Python path
sys.path.insert(0, str(MODULES_DIR))


# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def workspace():
    """Workspace root directory"""
    return WORKSPACE


@pytest.fixture
def skills_dir():
    """Skills directory"""
    return SKILLS_DIR


@pytest.fixture
def state_dir():
    """State directory (~/.openclaw)"""
    return STATE_DIR


@pytest.fixture
def skill_registry_path():
    """Skill registry JSON file path"""
    return STATE_DIR / 'memory' / 'skill_registry.json'


@pytest.fixture
def memory_dir():
    """Memory directory"""
    return STATE_DIR / 'memory'


@pytest.fixture
def skills_list():
    """List of installed skill names"""
    if not SKILLS_DIR.exists():
        return []
    return [d.name for d in SKILLS_DIR.iterdir() if d.is_dir() and (d / 'SKILL.md').exists()]


@pytest.fixture
def sample_skill_name():
    """A known existing skill for testing"""
    return 'agent-browser'


@pytest.fixture
def mock_event():
    """Sample skill event"""
    return {
        'context': {
            'content': '/test-skill',
        },
        'message': {
            'content': '/test-skill',
        },
    }


@pytest.fixture
def mock_http_response():
    """Mock HTTP response for API tests"""
    class MockResponse:
        def __init__(self, status=200, json_data=None, text=''):
            self.status = status
            self._json = json_data
            self.text = text

        def json(self):
            return self._json

    return MockResponse


# ─── pytest Options ──────────────────────────────────────────────────────────

def pytest_configure(config):
    """Register custom markers"""
    config.addinivalue_line('markers', 'unit: Unit tests')
    config.addinivalue_line('markers', 'e2e: End-to-end tests')
    config.addinivalue_line('markers', 'slow: Slow running tests')
    config.addinivalue_line('markers', 'integration: Integration tests')


def pytest_collection_modifyitems(config, items):
    """Auto-mark tests based on location"""
    for item in items:
        if 'e2e' in str(item.fspath):
            item.add_marker(pytest.mark.e2e)
        elif 'unit' in str(item.fspath):
            item.add_marker(pytest.mark.unit)
        if 'slow' in item.name:
            item.add_marker(pytest.mark.slow)
