/**
 * E2E test for ontology knowledge graph
 * Tests that the graph.jsonl can be read and queried
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('ontology graph loads and has expected structure', () => {
  const graphPath = resolve(process.env.OPENCLAW_MEMORY!, 'ontology/graph.jsonl');
  const content = readFileSync(graphPath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);
  
  // Should have entities
  const entities = lines.filter(l => l.includes('"op":"create"'));
  expect(entities.length).toBeGreaterThan(0);
  
  // Should have relations
  const relations = lines.filter(l => l.includes('"op":"relate"'));
  expect(relations.length).toBeGreaterThan(0);
  
  // Parse first entity
  const firstEntity = JSON.parse(lines[0]);
  expect(firstEntity.entity).toHaveProperty('id');
  expect(firstEntity.entity).toHaveProperty('type');
  expect(firstEntity.entity).toHaveProperty('properties');
});

test('ontology has required project types', () => {
  const graphPath = resolve(process.env.OPENCLAW_MEMORY!, 'ontology/graph.jsonl');
  const content = readFileSync(graphPath, 'utf-8');
  const lines = content.trim().split('\n');
  
  const projects = lines
    .map(l => JSON.parse(l))
    .filter(op => op.entity?.type === 'Project');
  
  const projectNames = projects.map(p => p.entity.properties.name);
  expect(projectNames).toContain('OpenClaw Skills 学习');
});

test('ontology schema defines constraints', () => {
  const schemaPath = resolve(process.env.OPENCLAW_MEMORY!, 'ontology/schema.yaml');
  const content = readFileSync(schemaPath, 'utf-8');
  
  expect(content).toContain('types:');
  expect(content).toContain('Task:');
  expect(content).toContain('Project:');
  expect(content).toContain('relations:');
});
