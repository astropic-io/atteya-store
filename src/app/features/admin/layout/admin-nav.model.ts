export interface AdminNavSubItem {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly icon?: string;
  readonly badge?: string;
  readonly description?: string;
  /** Only admins see it (staff don't). */
  readonly adminOnly?: boolean;
  /** The Overview page (ATS-340): hidden where `environment.adminOverview` is off. */
  readonly overview?: boolean;
}

export interface AdminNavCategory {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly path?: string;
  readonly badge?: string;
  readonly subItems?: readonly AdminNavSubItem[];
}
