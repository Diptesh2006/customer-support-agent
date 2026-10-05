import type { CostEvent } from './types.js';

/**
 * The turn's cost once its web search is counted. `search` is the search's own
 * cost, `'unknown'` when a search was sent and its charge never came back, or
 * undefined when no search cost applies (none ran, or the provider reports none).
 *
 * The total is exact only when both parts are; otherwise it is unpriced, never a
 * partial sum presented as the whole and never zero. The parts stay visible.
 */
export function addSearchCost(chat: CostEvent, search: CostEvent | 'unknown' | undefined): CostEvent {
  if (search === undefined) return chat;

  const chatPart = chat.status === 'exact' ? chat.costUsd : null;
  const searchPart = search !== 'unknown' && search.status === 'exact' ? search.costUsd : null;
  const exact = chatPart !== null && searchPart !== null;

  const out: CostEvent = {
    costUsd: exact ? chatPart + searchPart : null,
    status: exact ? 'exact' : 'unpriced',
    chatCostUsd: chatPart,
    searchCostUsd: searchPart,
  };
  if (chat.requestId) out.requestId = chat.requestId;
  return out;
}
