"""
tests/conftest.py
Shared pytest fixtures for registry-test-20100 tests
"""

import pytest
import sys
from pathlib import Path

# Add skill to path: registry-test-20100
skill_path = Path(__file__).parent.parent / 'registry-test-20100'
sys.path.insert(0, str(skill_path))

@pytest.fixture
def skill_path():
    return Path(__file__).parent.parent / 'registry-test-20100'

@pytest.fixture
def sample_input():
    return {'context': {'content': '/registry-test-20100'}, 'message': {'content': '/registry-test-20100'}}
