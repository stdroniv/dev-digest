interface Container {
  db: {
    exports: {
      findById(workspaceId: string, exportId: string): Promise<ExportRow | null>;
      insert(row: Omit<ExportRow, 'id'>): Promise<ExportRow>;
      listByWorkspace(workspaceId: string, limit: number): Promise<ExportRow[]>;
    };
  };
}

interface ExportRow {
  id: string;
  workspaceId: string;
  digestId: string;
  format: 'pdf' | 'csv';
  status: 'queued' | 'processing' | 'done' | 'failed';
  downloadUrl: string | null;
}

export class ExportsService {
  constructor(private readonly container: Container) {}

  async findById(workspaceId: string, exportId: string) {
    return this.container.db.exports.findById(workspaceId, exportId);
  }

  async create(workspaceId: string, digestId: string, format: 'pdf' | 'csv') {
    return this.container.db.exports.insert({
      workspaceId,
      digestId,
      format,
      status: 'queued',
      downloadUrl: null,
    });
  }

  async listRecent(workspaceId: string, limit: number) {
    return this.container.db.exports.listByWorkspace(workspaceId, limit);
  }
}
