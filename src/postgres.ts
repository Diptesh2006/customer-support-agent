import { randomUUID } from 'node:crypto';
import type { KnowledgeIndex, KnowledgeStore, ScoredChunk, SearchOptions } from './types.js';
import { SupportAgentError } from './errors.js';
import { validateIndex } from './knowledge/validate.js';

/** Minimal pg-compatible interfaces; applications provide their own configured pool. */
export interface PostgresQueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount?: number | null;
}

export interface PostgresConnection {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<PostgresQueryResult<Row>>;
  release(): void;
}

export interface PostgresPool {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<PostgresQueryResult<Row>>;
  connect(): Promise<PostgresConnection>;
}

export interface PostgresKnowledgeStoreOptions {
  embeddingModel: string;
  dimensions: number;
}

const POSTGRES_VECTOR_DIMENSIONS = 768;

function checkedTenantId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) {
    throw new SupportAgentError('invalid_request', 'a trusted tenantId is required for PostgreSQL knowledge search');
  }
  return value;
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

/**
 * Tenant-scoped pgvector search. The tenant ID must come from TrustedContext,
 * which the host constructs after verifying the user's session.
 */
export function createPostgresKnowledgeStore(
  pool: PostgresPool,
  options: PostgresKnowledgeStoreOptions,
): KnowledgeStore {
  if (!options.embeddingModel.trim()) throw new SupportAgentError('invalid_config', 'embeddingModel is required');
  if (options.dimensions !== POSTGRES_VECTOR_DIMENSIONS) {
    throw new SupportAgentError('invalid_config', `the included PostgreSQL migration requires ${POSTGRES_VECTOR_DIMENSIONS} embedding dimensions`);
  }

  return {
    embeddingModel: options.embeddingModel,
    dimensions: options.dimensions,
    async search(queryEmbedding: number[], opts: SearchOptions): Promise<ScoredChunk[]> {
      const tenantId = checkedTenantId(opts.tenantId);
      if (queryEmbedding.length !== options.dimensions || queryEmbedding.some(value => !Number.isFinite(value))) {
        throw new SupportAgentError('invalid_request', 'query embedding does not match the PostgreSQL index dimensions');
      }
      if (!Number.isInteger(opts.topK) || opts.topK < 1 || opts.topK > 50) {
        throw new SupportAgentError('invalid_request', 'topK must be an integer between 1 and 50');
      }

      const result = await pool.query<{
        id: string;
        title: string;
        url: string;
        content: string;
        audiences: string[];
        similarity: number | string;
      }>(
        `SELECT chunk.chunk_id AS id, chunk.title, chunk.url, chunk.content, chunk.audiences,
                1 - (chunk.embedding <=> $1::vector) AS similarity
           FROM support_agent_knowledge_chunks AS chunk
           JOIN support_agent_knowledge_indexes AS active
             ON active.tenant_id = chunk.tenant_id
            AND active.generation_id = chunk.generation_id
          WHERE chunk.tenant_id = $2
            AND active.embedding_model = $5
            AND active.dimensions = $6
            AND (cardinality(chunk.audiences) = 0 OR COALESCE($3::text[], ARRAY[]::text[]) && chunk.audiences)
          ORDER BY chunk.embedding <=> $1::vector, chunk.chunk_id
          LIMIT $4`,
        [vectorLiteral(queryEmbedding), tenantId, opts.audiences ?? [], opts.topK, options.embeddingModel, options.dimensions],
      );

      return result.rows.map(row => ({
        id: row.id,
        title: row.title,
        url: row.url,
        content: row.content,
        ...(row.audiences?.length ? { audiences: row.audiences } : {}),
        similarity: Number(row.similarity),
      }));
    },
  };
}

/**
 * Atomically publish a complete tenant index. New chunks are written under an
 * inactive generation, then the active pointer is swapped in the same
 * transaction; a failed sync leaves the old index available.
 */
export async function syncPostgresKnowledgeIndex(
  pool: PostgresPool,
  tenantIdValue: string,
  indexValue: KnowledgeIndex,
): Promise<{ generationId: string; chunkCount: number }> {
  const tenantId = checkedTenantId(tenantIdValue);
  const index = validateIndex(indexValue);
  if (index.dimensions !== POSTGRES_VECTOR_DIMENSIONS) {
    throw new SupportAgentError('invalid_index', `the included PostgreSQL migration requires ${POSTGRES_VECTOR_DIMENSIONS} embedding dimensions`);
  }

  const connection = await pool.connect();
  const generationId = randomUUID();
  try {
    await connection.query('BEGIN');
    // Serialize full-index replacements for the same tenant, including its first index build.
    await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [tenantId]);
    for (const chunk of index.chunks) {
      await connection.query(
        `INSERT INTO support_agent_knowledge_chunks
           (tenant_id, generation_id, chunk_id, title, url, content, audiences, embedding)
         VALUES ($1, $2::uuid, $3, $4, $5, $6, $7::text[], $8::vector)`,
        [tenantId, generationId, chunk.id, chunk.title, chunk.url, chunk.content, chunk.audiences ?? [], vectorLiteral(chunk.embedding)],
      );
    }
    await connection.query(
      `INSERT INTO support_agent_knowledge_indexes
         (tenant_id, generation_id, embedding_model, dimensions, updated_at)
       VALUES ($1, $2::uuid, $3, $4, now())
       ON CONFLICT (tenant_id) DO UPDATE SET
         generation_id = EXCLUDED.generation_id,
         embedding_model = EXCLUDED.embedding_model,
         dimensions = EXCLUDED.dimensions,
         updated_at = EXCLUDED.updated_at`,
      [tenantId, generationId, index.embeddingModel, index.dimensions],
    );
    await connection.query(
      `DELETE FROM support_agent_knowledge_chunks
        WHERE tenant_id = $1 AND generation_id <> $2::uuid`,
      [tenantId, generationId],
    );
    await connection.query('COMMIT');
    return { generationId, chunkCount: index.chunks.length };
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}
