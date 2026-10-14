CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS support_agent_knowledge_indexes (
  tenant_id text PRIMARY KEY,
  generation_id uuid NOT NULL,
  embedding_model text NOT NULL,
  dimensions integer NOT NULL CHECK (dimensions = 768),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_agent_knowledge_chunks (
  tenant_id text NOT NULL,
  generation_id uuid NOT NULL,
  chunk_id text NOT NULL,
  title text NOT NULL,
  url text NOT NULL,
  content text NOT NULL,
  audiences text[] NOT NULL DEFAULT ARRAY[]::text[],
  embedding vector(768) NOT NULL,
  PRIMARY KEY (tenant_id, generation_id, chunk_id)
);

CREATE INDEX IF NOT EXISTS support_agent_knowledge_chunks_embedding_hnsw
  ON support_agent_knowledge_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS support_agent_knowledge_chunks_tenant_generation
  ON support_agent_knowledge_chunks (tenant_id, generation_id);
