import type { ChatImportTask } from "@/lib/types";
import { assetByChecksum, persistChatImportBatchInStore, persistUploadInStore } from "./chat-import-persistence";
import { acknowledgeChatImportCancel, claimChatImportTask, completeChatImportTask, completeChatImportWithWarnings, createChatImportTask, failChatImportTask, heartbeatChatImportTask, listChatImportTasks, requestChatImportCancel, retryChatImportTask, saveChatImportCheckpoint } from "./chat-import-state";
import type { ChatImportRepository, ChatImportTaskAcknowledgeInput, ChatImportTaskClaimInput, ChatImportTaskCompletionInput, ChatImportTaskCreateInput, ChatImportTaskFailureInput, ChatImportTaskLeaseInput, ChatImportTaskListFilter, ChatImportTaskWarningsInput, Repository, Store, UploadPersistInput, UploadPersistResult } from "./repository-interface";

function emptyStore(): Store {
  return { profile: { id: "in-memory-profile", displayName: "In-memory", birthDate: "2020-01-01", timezone: "UTC", bio: "", visibility: "private" }, contributors: [], media: [], mediaAssets: [], mediaLocations: [], connectorStates: [], rawSources: [], events: [], dailyTraces: [], growthRecords: [], careRecords: [], careEpisodes: [], monthlyFocusGoals: [], organizerRuns: [], organizerJobs: [], chatImportTasks: [], links: [], qualityReviews: [], monthlySnapshot: { id: "in-memory-snapshot", profileId: "in-memory-profile", month: "1970-01", summary: "", highlights: [], visibility: "private" } };
}

function withDefaults(initial: Partial<Store> = {}) {
  const base = emptyStore();
  return { ...base, ...initial, contributors: initial.contributors ?? [], media: initial.media ?? [], mediaAssets: initial.mediaAssets ?? [], mediaLocations: initial.mediaLocations ?? [], connectorStates: initial.connectorStates ?? [], rawSources: initial.rawSources ?? [], events: initial.events ?? [], dailyTraces: initial.dailyTraces ?? [], growthRecords: initial.growthRecords ?? [], careRecords: initial.careRecords ?? [], careEpisodes: initial.careEpisodes ?? [], monthlyFocusGoals: initial.monthlyFocusGoals ?? [], organizerRuns: initial.organizerRuns ?? [], organizerJobs: initial.organizerJobs ?? [], chatImportTasks: initial.chatImportTasks ?? [], links: initial.links ?? [], qualityReviews: initial.qualityReviews ?? [] } satisfies Store;
}

export type InMemoryRepository = ChatImportRepository & Pick<Repository, "getStore" | "persistUpload" | "findMediaAssetByChecksum" | "appendUpload">;

export function createInMemoryRepository(initial: Partial<Store> = {}): InMemoryRepository {
  const store = withDefaults(initial);
  let mutationTail: Promise<void> = Promise.resolve();
  const mutate = async <T>(operation: () => T | Promise<T>) => {
    const next = mutationTail.then(operation, operation);
    mutationTail = next.then(() => undefined, () => undefined);
    return next;
  };
  const persist = (input: UploadPersistInput) => mutate(() => {
    const draft: Store = { ...store, rawSources: store.rawSources.slice(), media: store.media.slice(), mediaAssets: store.mediaAssets.slice(), mediaLocations: store.mediaLocations.slice() };
    const result = persistUploadInStore(draft, input);
    store.rawSources = draft.rawSources;
    store.media = draft.media;
    store.mediaAssets = draft.mediaAssets;
    store.mediaLocations = draft.mediaLocations;
    return result;
  });
  return {
    async getStore() { return store; },
    async appendUpload(input) { return (await persist(input)).source; },
    async persistUpload(input) { return persist(input); },
    async findMediaAssetByChecksum(checksum) { return assetByChecksum(store, checksum); },
    async persistChatImportMessage(input) { return persist(input); },
    async persistChatImportBatch(inputs) {
      return mutate(() => {
        const draft: Store = { ...store, rawSources: store.rawSources.slice(), media: store.media.slice(), mediaAssets: store.mediaAssets.slice(), mediaLocations: store.mediaLocations.slice() };
        const result = persistChatImportBatchInStore(draft, inputs);
        store.rawSources = draft.rawSources;
        store.media = draft.media;
        store.mediaAssets = draft.mediaAssets;
        store.mediaLocations = draft.mediaLocations;
        return result;
      });
    },
    async createChatImportTask(input: ChatImportTaskCreateInput) { return mutate(() => createChatImportTask(store.chatImportTasks, input)); },
    async getChatImportTask(id) { return store.chatImportTasks.find((task) => task.id === id) ?? null; },
    async listChatImportTasks(filter?: ChatImportTaskListFilter) { return listChatImportTasks(store.chatImportTasks, filter); },
    async claimChatImportTask(input: ChatImportTaskClaimInput) { return mutate(() => claimChatImportTask(store.chatImportTasks, input)); },
    async heartbeatChatImportTask(input: ChatImportTaskLeaseInput) { return mutate(() => heartbeatChatImportTask(store.chatImportTasks, input)); },
    async saveChatImportCheckpoint(input) { return mutate(() => saveChatImportCheckpoint(store.chatImportTasks, input)); },
    async requestChatImportCancel(taskId, now) { return mutate(() => requestChatImportCancel(store.chatImportTasks, taskId, now)); },
    async acknowledgeChatImportCancel(input: ChatImportTaskAcknowledgeInput) { return mutate(() => acknowledgeChatImportCancel(store.chatImportTasks, input)); },
    async failChatImportTask(input: ChatImportTaskFailureInput) { return mutate(() => failChatImportTask(store.chatImportTasks, input)); },
    async retryChatImportTask(taskId, now) { return mutate(() => retryChatImportTask(store.chatImportTasks, taskId, now)); },
    async completeChatImportTask(input: ChatImportTaskCompletionInput) { return mutate(() => completeChatImportTask(store.chatImportTasks, input)); },
    async completeChatImportWithWarnings(input: ChatImportTaskWarningsInput) { return mutate(() => completeChatImportWithWarnings(store.chatImportTasks, input)); },
  };
}

export class AsyncChatImportRepository implements ChatImportRepository {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly delegate: ChatImportRepository) {}

  private enqueue<T>(operation: () => Promise<T>) {
    const next = this.tail.then(operation, operation);
    this.tail = next.then(() => undefined, () => undefined);
    return next;
  }

  createChatImportTask(input: ChatImportTaskCreateInput) { return this.enqueue(() => this.delegate.createChatImportTask(input)); }
  getChatImportTask(id: string) { return this.enqueue(() => this.delegate.getChatImportTask(id)); }
  listChatImportTasks(filter?: ChatImportTaskListFilter) { return this.enqueue(() => this.delegate.listChatImportTasks(filter)); }
  claimChatImportTask(input: ChatImportTaskClaimInput) { return this.enqueue(() => this.delegate.claimChatImportTask(input)); }
  heartbeatChatImportTask(input: ChatImportTaskLeaseInput) { return this.enqueue(() => this.delegate.heartbeatChatImportTask(input)); }
  saveChatImportCheckpoint(input: Parameters<ChatImportRepository["saveChatImportCheckpoint"]>[0]) { return this.enqueue(() => this.delegate.saveChatImportCheckpoint(input)); }
  requestChatImportCancel(taskId: string, now?: string) { return this.enqueue(() => this.delegate.requestChatImportCancel(taskId, now)); }
  acknowledgeChatImportCancel(input: ChatImportTaskAcknowledgeInput) { return this.enqueue(() => this.delegate.acknowledgeChatImportCancel(input)); }
  failChatImportTask(input: ChatImportTaskFailureInput) { return this.enqueue(() => this.delegate.failChatImportTask(input)); }
  retryChatImportTask(taskId: string, now?: string) { return this.enqueue(() => this.delegate.retryChatImportTask(taskId, now)); }
  completeChatImportTask(input: ChatImportTaskCompletionInput) { return this.enqueue(() => this.delegate.completeChatImportTask(input)); }
  completeChatImportWithWarnings(input: ChatImportTaskWarningsInput) { return this.enqueue(() => this.delegate.completeChatImportWithWarnings(input)); }
  persistChatImportMessage(input: UploadPersistInput) { return this.enqueue(() => this.delegate.persistChatImportMessage(input)); }
  persistChatImportBatch(inputs: UploadPersistInput[]) { return this.enqueue(() => this.delegate.persistChatImportBatch(inputs)); }
}

export function createAsyncChatImportRepository(repository: ChatImportRepository) {
  return new AsyncChatImportRepository(repository);
}

export const createAsyncRepository = createAsyncChatImportRepository;
export type { ChatImportTask, UploadPersistInput, UploadPersistResult };
