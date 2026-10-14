import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeIndex } from '../src/types.js';
import { createPostgresKnowledgeStore, syncPostgresKnowledgeIndex, type PostgresConnection, type PostgresPool } from '../src/postgres.js';

const index: KnowledgeIndex = {
  version: 1,
  embeddingModel: 'embed-test',
  dimensions: 768,
  createdAt: new Date().toISOString(),
  chunks: [{ id: 'chunk-1', title: 'Help', url: 'https://docs.example/help', content: 'Helpful answer', audiences: ['customer'], embedding: [0.1, 0.2, ...Array(766).fill(0)] }],
};

function poolMock() {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const connection: PostgresConnection = { query, release: vi.fn() };
  const pool: PostgresPool = { query, connect: vi.fn().mockResolvedValue(connection) };
  return { pool, connection, query };
}

describe('PostgreSQL knowledge store', () => {
  it('requires a trusted tenant ID and applies tenant, audience, model and dimension filters', async () => {
    const { pool, query } = poolMock();
    query.mockResolvedValueOnce({ rows: [{ id: 'chunk-1', title: 'Help', url: 'https://docs.example/help', content: 'Helpful answer', audiences: ['customer'], similarity: '0.91' }] });
    const store = createPostgresKnowledgeStore(pool, { embeddingModel: 'embed-test', dimensions: 768 });

    const queryEmbedding = [0.1, 0.2, ...Array(766).fill(0)];
    await expect(store.search(queryEmbedding, { topK: 3 })).rejects.toThrow('trusted tenantId is required');
    await expect(store.search(queryEmbedding, { topK: 3, tenantId: 'org-1', audiences: ['customer'] }))
      .resolves.toEqual([{ id: 'chunk-1', title: 'Help', url: 'https://docs.example/help', content: 'Helpful answer', audiences: ['customer'], similarity: 0.91 }]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0]?.[1]?.[0])).toMatch(/^\[0\.1,0\.2,0,0/);
    expect(query.mock.calls[0]?.[1]?.slice(1)).toEqual(['org-1', ['customer'], 3, 'embed-test', 768]);
    expect(query.mock.calls[0]?.[0]).toContain('chunk.tenant_id = $2');
  });

  it('publishes an index snapshot transactionally and releases the connection', async () => {
    const { pool, connection, query } = poolMock();

    const result = await syncPostgresKnowledgeIndex(pool, 'org-1', index);

    expect(result.chunkCount).toBe(1);
    expect(result.generationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(query.mock.calls.map(call => call[0])).toEqual([
      'BEGIN',
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      expect.stringContaining('INSERT INTO support_agent_knowledge_chunks'),
      expect.stringContaining('INSERT INTO support_agent_knowledge_indexes'),
      expect.stringContaining('DELETE FROM support_agent_knowledge_chunks'),
      'COMMIT',
    ]);
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('rolls back on a failed chunk write, preserving the active generation', async () => {
    const { pool, connection, query } = poolMock();
    query.mockRejectedValueOnce(new Error('insert failed'));

    await expect(syncPostgresKnowledgeIndex(pool, 'org-1', index)).rejects.toThrow('insert failed');
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(connection.release).toHaveBeenCalledOnce();
  });
});
