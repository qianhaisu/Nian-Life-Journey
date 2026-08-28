import type { QuarkAuthStatus, QuarkClient, QuarkFile, QuarkListPage, QuarkScope } from "../../lib/ingest/quark";

export type FakeQuarkClientOptions = {
  pages?: QuarkListPage[];
  files?: Record<string, Uint8Array>;
  auth?: QuarkAuthStatus;
  listFailures?: number;
  downloadFailures?: number;
};

export class FakeQuarkClient implements QuarkClient {
  readonly listScopes: QuarkScope[] = [];
  readonly downloadRefs: string[] = [];
  private readonly pages: QuarkListPage[];
  private readonly files: Map<string, Uint8Array>;
  private readonly auth: QuarkAuthStatus;
  private listFailures: number;
  private successfulListCalls = 0;
  private downloadFailures: number;

  constructor(options: FakeQuarkClientOptions = {}) {
    this.pages = options.pages ?? [{ files: [] }];
    this.files = new Map(Object.entries(options.files ?? {}));
    this.auth = options.auth ?? { status: "connected", message: "fake authorization is available" };
    this.listFailures = options.listFailures ?? 0;
    this.downloadFailures = options.downloadFailures ?? 0;
  }

  async checkAuth() {
    return this.auth;
  }

  async list(scope: QuarkScope) {
    this.listScopes.push({ ...scope });
    if (this.listFailures > 0) {
      this.listFailures -= 1;
      throw new Error("temporary fake list failure");
    }
    const page = this.pages[Math.min(this.successfulListCalls, this.pages.length - 1)];
    this.successfulListCalls += 1;
    return page;
  }

  async download(providerRef: string) {
    this.downloadRefs.push(providerRef);
    if (this.downloadFailures > 0) {
      this.downloadFailures -= 1;
      throw new Error("temporary fake read failure");
    }
    const bytes = this.files.get(providerRef);
    if (!bytes) throw new Error(`fake file not found: ${providerRef}`);
    return bytes;
  }
}

export function quarkFile(overrides: Partial<QuarkFile> = {}): QuarkFile {
  return { providerRef: "fake-provider-ref", filename: "memory.jpg", mimeType: "image/jpeg", ...overrides };
}