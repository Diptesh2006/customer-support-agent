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

/**
 * Several chat calls made for one turn, as one cost: exact only when every
 * call is, otherwise unpriced. The request id is the last call's, the answer
 * the visitor saw.
 */
export function sumChatCosts(costs: CostEvent[]): CostEvent {
  const last = costs[costs.length - 1]!;
  if (costs.length === 1) return last;
  const exact = costs.every(c => c.status === 'exact' && c.costUsd !== null);
  const out: CostEvent = exact
    ? { costUsd: costs.reduce((sum, c) => sum + (c.costUsd as number), 0), status: 'exact' }
    : { costUsd: null, status: 'unpriced' };
  if (last.requestId) out.requestId = last.requestId;
  return out;
}
