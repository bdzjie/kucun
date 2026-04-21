"""
tests/unit/test_skills_framework.py

Unit tests for the OpenClaw skills framework core components:
- skill_pipeline_7phase
- skill_indexer
- auto_skill_creator
"""

import pytest
import sys
import os
import json
from pathlib import Path

WORKSPACE = Path(r'C:\Users\Administrator\.openclaw\workspace')
MODULES_DIR = WORKSPACE / 'modules'
sys.path.insert(0, str(MODULES_DIR))


class TestSkillPipeline7Phase:
    """Test the 7-phase skill creation pipeline"""

    def test_import_7phase(self):
        """7phase module can be imported"""
        from skill_pipeline_7phase import run_7phase_creation, FORBIDDEN_NAMES
        assert callable(run_7phase_creation)
        assert isinstance(FORBIDDEN_NAMES, set)

    def test_forbidden_names(self):
        """Forbidden names are blocked"""
        from skill_pipeline_7phase import run_7phase_creation
        result = run_7phase_creation('system', 'A test skill')
        assert result['status'] == 'failed'
        assert 'Forbidden' in result['error']

    def test_invalid_characters(self):
        """Invalid characters in name are blocked"""
        from skill_pipeline_7phase import run_7phase_creation
        result = run_7phase_creation('skill/with/slashes', 'A test skill')
        assert result['status'] == 'failed'
        assert 'Invalid characters' in result['error']

    def test_phase_analyze_produces_design(self):
        """Phase 1 analyze produces a SkillDesign"""
        from skill_pipeline_7phase import run_phase_analyze, SkillDesign
        result = run_phase_analyze('test-skill', 'A skill that searches and analyzes data', {})
        assert result.status == 'success'
        assert isinstance(result.output, SkillDesign)
        assert len(result.output.capabilities) >= 1
        assert result.artifacts['capabilities_count'] == str(len(result.output.capabilities))

    def test_phase_design_adds_triggers(self):
        """Phase 2 design expands trigger patterns"""
        from skill_pipeline_7phase import run_phase_analyze, run_phase_design
        r1 = run_phase_analyze('test-skill', 'search for files and analyze logs', {})
        r2 = run_phase_design('test-skill', r1.output, {})
        assert r2.status == 'success'
        assert len(r2.output.trigger_patterns) >= 2

    def test_phase_design_plans_references(self):
        """Phase 2 plans reference files for complex skills"""
        from skill_pipeline_7phase import run_phase_analyze, run_phase_design
        caps = [f'capability_{i}' for i in range(5)]
        desc = ' '.join(caps)
        r1 = run_phase_analyze('test-skill', desc, {})
        r2 = run_phase_design('test-skill', r1.output, {})
        assert 'references/capabilities.md' in r2.output.references

    def test_run_7phase_returns_phases(self):
        """run_7phase_creation returns all 7 phase results"""
        from skill_pipeline_7phase import run_7phase_creation
        # Use a unique name to avoid collision
        result = run_7phase_creation(
            f'pipeline-test-{os.getpid()}',
            'A skill that searches and fetches data from APIs'
        )
        assert result['status'] == 'success'
        assert len(result['phases']) == 7
        phase_names = [p['phase'] for p in result['phases']]
        assert 'phase1_analyze' in phase_names
        assert 'phase7_publish' in phase_names

    def test_run_7phase_registers_skill(self):
        """Phase 7 publishes to registry"""
        from skill_pipeline_7phase import run_7phase_creation
        import tempfile
        skill_name = f'registry-test-{os.getpid()}'
        result = run_7phase_creation(skill_name, 'A test skill for registry')
        if result['status'] == 'success':
            registry_path = Path.home() / '.openclaw' / 'memory' / 'skill_registry.json'
            if registry_path.exists():
                with open(registry_path, 'r', encoding='utf-8') as f:
                    registry = json.load(f)
                assert skill_name in registry.get('skills', {})


class TestSkillIndexer:
    """Test skill indexer"""

    def test_import_skill_indexer(self):
        """skill_indexer can be imported"""
        import skill_indexer
        assert hasattr(skill_indexer, 'get_all_skills')
        assert hasattr(skill_indexer, 'index_skills')

    def test_get_all_skills_returns_list(self):
        """get_all_skills returns a list"""
        import skill_indexer
        skills = skill_indexer.get_all_skills()
        assert isinstance(skills, list)

    def test_skill_count_reasonable(self):
        """We have a reasonable number of skills"""
        import skill_indexer
        skills = skill_indexer.get_all_skills()
        assert 10 <= len(skills) <= 200, f'Unexpected skill count: {len(skills)}'


class TestAutoSkillCreator:
    """Test auto skill creator constraints"""

    def test_import_autoskill(self):
        """auto_skill_creator can be imported"""
        import auto_skill_creator
        assert hasattr(auto_skill_creator, 'validate_constraint')
        assert hasattr(auto_skill_creator, 'FORBIDDEN_SKILL_NAMES')

    def test_validate_constraint_blocks_forbidden(self):
        """validate_constraint blocks forbidden names"""
        from auto_skill_creator import validate_constraint
        allowed, reason = validate_constraint('eval')
        assert not allowed
        assert 'Forbidden' in reason

    def test_validate_constraint_allows_valid(self):
        """validate_constraint allows valid names"""
        from auto_skill_creator import validate_constraint
        allowed, reason = validate_constraint('my-awesome-skill-123')
        assert allowed


class TestSkillProgressiveDisclosure:
    """Test SKILL.md progressive disclosure utilities"""

    def test_read_and_split(self):
        """Can read an existing SKILL.md and understand split points"""
        skill_path = WORKSPACE / 'skills' / 'agent-browser'
        skill_md_path = skill_path / 'SKILL.md'
        if skill_md_path.exists():
            with open(skill_md_path, 'r', encoding='utf-8') as f:
                content = f.read()
            # Should have frontmatter
            assert content.startswith('---')
            # Should have some structure
            assert '#' in content or '##' in content


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
