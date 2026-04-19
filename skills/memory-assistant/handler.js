/**
 * memory-assistant skill handler
 * Unified memory system CLI — delegates to memory_integration.mjs
 */

const INTEGRATION_MODULE = 'C:/Users/Administrator/.openclaw/workspace/modules/knowledge/memory_integration.mjs';
const MEMORY_DIR = 'C:/Users/Administrator/.openclaw/memory';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  let integration;
  try {
    const mod = await import(`file://${INTEGRATION_MODULE}`);
    integration = mod.getMemoryIntegration();
  } catch (e) {
    console.log(JSON.stringify({ error: `Failed to load memory integration: ${e.message}` }));
    process.exit(1);
  }

  try {
    switch (command) {
      case '--status': {
        // Get memory counts
        const { getTemporalMemoryStore } = await import(`file://${INTEGRATION_MODULE}`);
        const store = getTemporalMemoryStore();
        const drawers = store ? store.getAllDrawers() : [];
        const graph = integration.graph;
        const triples = graph ? graph.getAllTriples() : [];
        
        console.log(JSON.stringify({
          status: 'ok',
          memories: drawers.length,
          triples: triples.length,
          palaceSearch: 'available',
        }));
        break;
      }

      case '--graph': {
        const showMermaid = args.includes('--mermaid');
        const mermaid = integration.toMermaid();
        if (showMermaid) {
          console.log('```mermaid\n' + mermaid + '\n```');
        } else {
          // Return as JSON triples
          const triples = integration.graph.getAllTriples();
          console.log(JSON.stringify({ triples }, null, 2));
        }
        break;
      }

      case '--provenance': {
        const entryId = args[1];
        if (!entryId) {
          console.log(JSON.stringify({ error: 'Usage: --provenance <entry-id>' }));
          break;
        }
        const chain = integration.getProvenanceChain(entryId);
        console.log(JSON.stringify({ entryId, chain }, null, 2));
        break;
      }

      case '--core': {
        const action = args[1];
        if (action === '--export') {
          const domainIdx = args.indexOf('--domain');
          const domain = domainIdx !== -1 ? args[domainIdx + 1] : 'all';
          const pathIdx = args.indexOf('--path');
          const path = pathIdx !== -1 ? args[pathIdx + 1] : null;
          
          const core = integration.createCore(domain);
          if (path) {
            core.export(path);
            console.log(JSON.stringify({ exported: path, domain }));
          } else {
            // Print to stdout
            const exported = core.toJSON();
            console.log(JSON.stringify(exported, null, 2));
          }
        } else if (action === '--import') {
          const importPath = args[1];
          if (!importPath) {
            console.log(JSON.stringify({ error: 'Usage: --core --import <path>' }));
            break;
          }
          const result = await integration.loadCore(importPath);
          console.log(JSON.stringify({ imported: importPath, ...result }));
        } else {
          console.log(JSON.stringify({ error: 'Usage: --core --export [--domain all] [--path <path>] OR --core --import <path>' }));
        }
        break;
      }

      case '--feedback': {
        const id = args[1];
        const used = args.includes('--used');
        const rejected = args.includes('--rejected');
        
        if (!id) {
          console.log(JSON.stringify({ error: 'Usage: --feedback <id> [--used|--rejected]' }));
          break;
        }
        
        if (used) {
          integration.recordRetrievalUsed(id);
          console.log(JSON.stringify({ recorded: 'used', id }));
        } else if (rejected) {
          integration.recordRetrievalRejected(id);
          console.log(JSON.stringify({ recorded: 'rejected', id }));
        } else {
          console.log(JSON.stringify({ error: 'Must specify --used or --rejected' }));
        }
        break;
      }

      case '--stats': {
        const topDecision = integration.getTopPerforming('decision', 5);
        const topPreference = integration.getTopPerforming('preference', 5);
        const topMilestone = integration.getTopPerforming('milestone', 5);
        console.log(JSON.stringify({
          topDecision,
          topPreference,
          topMilestone,
        }, null, 2));
        break;
      }

      case '--topics': {
        // Topics need conversation context - return empty for now
        console.log(JSON.stringify({ topics: [], note: 'Provide conversation messages for topic detection' }));
        break;
      }

      case '--suggest': {
        // Proactive suggestions need conversation context
        console.log(JSON.stringify({ suggestions: [], note: 'Provide conversation messages for suggestions' }));
        break;
      }

      case '--bm25': {
        const query = args.slice(1).join(' ');
        if (!query) {
          console.log(JSON.stringify({ error: 'Usage: --bm25 <query>' }));
          break;
        }
        const results = integration.bm25Search(query, { limit: 10 });
        console.log(JSON.stringify({ query, results }, null, 2));
        break;
      }

      case '--query': {
        const query = args.slice(1).join(' ');
        if (!query) {
          console.log(JSON.stringify({ error: 'Usage: --query <text>' }));
          break;
        }
        const results = await integration.fullQuery(query, []);
        console.log(JSON.stringify(results, null, 2));
        break;
      }

      default: {
        console.log(JSON.stringify({
          error: 'Unknown command',
          usage: [
            '--status',
            '--graph [--mermaid]',
            '--provenance <entry-id>',
            '--core --export [--domain all] [--path <path>]',
            '--core --import <path>',
            '--feedback <id> [--used|--rejected]',
            '--stats',
            '--topics',
            '--suggest',
            '--bm25 <query>',
            '--query <text>',
          ],
        }));
      }
    }
  } catch (e) {
    console.log(JSON.stringify({ error: e.message, stack: e.stack }));
    process.exit(1);
  }
}

main();
