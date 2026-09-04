// Thin facade: resolves REPOSITORY_BACKEND once at module load (throwing here, not later, on a
// bad config) and re-exports its methods under the same names every existing page, Server Action,
// Route Handler and Organizer file already imports from "@/lib/db/repository". Swapping backends
// never means editing a consumer file — only this module picks an implementation.
import { resolveRepositoryBackend } from "./config";
import { createJsonRepository } from "./json-repository";
import { createPostgresRepository } from "./postgres-repository";
import type { Repository } from "./repository-interface";

export type { EventDetail, OrganizerWindowInput, Store } from "./repository-interface";
export { newId } from "./repository-interface";

function createRepository(): Repository {
  const backend = resolveRepositoryBackend();
  return backend === "postgres" ? createPostgresRepository() : createJsonRepository();
}

const repository = createRepository();

export const getHomeEvents = repository.getHomeEvents.bind(repository);
export const getAllEvents = repository.getAllEvents.bind(repository);
export const getStore = repository.getStore.bind(repository);
export const getOrganizerStore = repository.getOrganizerStore.bind(repository);
export const getOrganizerWindowInput = repository.getOrganizerWindowInput.bind(repository);
export const getEventDetail = repository.getEventDetail.bind(repository);
export const appendUpload = repository.appendUpload.bind(repository);
export const persistUpload = repository.persistUpload.bind(repository);
export const persistChatImportMessage = repository.persistChatImportMessage.bind(repository);
export const persistChatImportBatch = repository.persistChatImportBatch.bind(repository);
export const createChatImportTask = repository.createChatImportTask.bind(repository);
export const getChatImportTask = repository.getChatImportTask.bind(repository);
export const listChatImportTasks = repository.listChatImportTasks.bind(repository);
export const claimChatImportTask = repository.claimChatImportTask.bind(repository);
export const heartbeatChatImportTask = repository.heartbeatChatImportTask.bind(repository);
export const saveChatImportCheckpoint = repository.saveChatImportCheckpoint.bind(repository);
export const requestChatImportCancel = repository.requestChatImportCancel.bind(repository);
export const acknowledgeChatImportCancel = repository.acknowledgeChatImportCancel.bind(repository);
export const failChatImportTask = repository.failChatImportTask.bind(repository);
export const retryChatImportTask = repository.retryChatImportTask.bind(repository);
export const completeChatImportTask = repository.completeChatImportTask.bind(repository);
export const completeChatImportWithWarnings = repository.completeChatImportWithWarnings.bind(repository);
export const findMediaAssetByChecksum = repository.findMediaAssetByChecksum.bind(repository);
export const updateMediaAsset = repository.updateMediaAsset.bind(repository);
export const updateMediaLocation = repository.updateMediaLocation.bind(repository);
export const removeMediaLocation = repository.removeMediaLocation.bind(repository);
export const findMediaLocationByProviderRef = repository.findMediaLocationByProviderRef.bind(repository);
export const appendMediaAssetWithLocation = repository.appendMediaAssetWithLocation.bind(repository);
export const updateMediaAssetWithLocation = repository.updateMediaAssetWithLocation.bind(repository);
export const getConnectorState = repository.getConnectorState.bind(repository);
export const upsertConnectorState = repository.upsertConnectorState.bind(repository);
export const markArchiveStatus = repository.markArchiveStatus.bind(repository);
export const recordArchivedOriginal = repository.recordArchivedOriginal.bind(repository);
export const persistOrganization = repository.persistOrganization.bind(repository);
export const persistDailyTrace = repository.persistDailyTrace.bind(repository);
export const persistCareEpisode = repository.persistCareEpisode.bind(repository);
export const persistQualityReview = repository.persistQualityReview.bind(repository);
export const findQualityReview = repository.findQualityReview.bind(repository);
export const persistMonthlySnapshot = repository.persistMonthlySnapshot.bind(repository);
export const markSourcesOrganized = repository.markSourcesOrganized.bind(repository);
export const markSourcesProcessing = repository.markSourcesProcessing.bind(repository);
export const findOrganizerRun = repository.findOrganizerRun.bind(repository);
export const persistOrganizerRun = repository.persistOrganizerRun.bind(repository);
export const undoOrganization = repository.undoOrganization.bind(repository);
export const enqueueOrganizerJob = repository.enqueueOrganizerJob.bind(repository);
export const claimNextOrganizerJob = repository.claimNextOrganizerJob.bind(repository);
export const completeOrganizerJob = repository.completeOrganizerJob.bind(repository);
export const failOrganizerJob = repository.failOrganizerJob.bind(repository);
export const getOrganizerJob = repository.getOrganizerJob.bind(repository);
export const recoverStuckOrganizerJobs = repository.recoverStuckOrganizerJobs.bind(repository);
