export interface Finding {
  id: string;
  file: string;
  message: string;
}

export function createFinding(id: string, file: string, message: string): Finding {
  return { id, file, message };
}
