# DrawSQL Clone — Database & API Design

**Stack:** FastAPI · SQL Server (MSSQL) · SQLAlchemy 2.x + pyodbc · Alembic · Pydantic v2
**Purpose:** Visual database diagram (ERD) tool — create diagrams, tables, columns, relationships; collaborate, version, share, import/export SQL.

---

## 1. Architecture

Layered pattern (matches routes → middleware → controller → service → constants):

```
app/
├── main.py
├── constants/          # enums, error codes, default values
├── routes/             # APIRouter per module (auth.py, diagrams.py, ...)
├── middleware/         # auth, rate-limit, request-id, workspace-permission deps
├── controllers/        # request/response orchestration
├── services/           # business logic + DB access
├── models/             # SQLAlchemy models
├── schemas/            # Pydantic request/response
├── core/               # config, db session, security (JWT, hashing)
└── utils/              # sql parser, sql generator, exporters
```

**Conventions**
- Base URL: `/api/v1`
- Auth: `Authorization: Bearer <access_token>` (JWT, 15 min) + refresh token (7–30 days)
- IDs: `UNIQUEIDENTIFIER` (UUID) — safe to generate client-side for offline/optimistic canvas edits
- Soft delete via `deleted_at` on user-facing entities
- Timestamps in UTC (`DATETIME2`)
- Pagination: `?page=1&page_size=20` → `{ items, total, page, page_size }`
- Error shape: `{ "error": { "code": "DIAGRAM_NOT_FOUND", "message": "...", "details": {} } }`

---

## 2. Database Tables (T-SQL)

### 2.1 Auth & Users

```sql
CREATE TABLE users (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    email               NVARCHAR(255)  NOT NULL UNIQUE,
    password_hash       NVARCHAR(255)  NULL,          -- null for OAuth-only users
    full_name           NVARCHAR(150)  NOT NULL,
    avatar_url          NVARCHAR(500)  NULL,
    is_active           BIT            NOT NULL DEFAULT 1,
    email_verified_at   DATETIME2      NULL,
    last_login_at       DATETIME2      NULL,
    created_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    deleted_at          DATETIME2      NULL
);

CREATE TABLE oauth_accounts (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    user_id             UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider            NVARCHAR(30)   NOT NULL,      -- google | github
    provider_user_id    NVARCHAR(255)  NOT NULL,
    created_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT uq_oauth UNIQUE (provider, provider_user_id)
);

CREATE TABLE refresh_tokens (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    user_id             UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash          NVARCHAR(255)  NOT NULL UNIQUE,
    user_agent          NVARCHAR(500)  NULL,
    ip_address          NVARCHAR(45)   NULL,
    expires_at          DATETIME2      NOT NULL,
    revoked_at          DATETIME2      NULL,
    created_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE password_reset_tokens (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    user_id             UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash          NVARCHAR(255)  NOT NULL UNIQUE,
    expires_at          DATETIME2      NOT NULL,
    used_at             DATETIME2      NULL
);

CREATE TABLE email_verification_tokens (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    user_id             UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash          NVARCHAR(255)  NOT NULL UNIQUE,
    expires_at          DATETIME2      NOT NULL,
    used_at             DATETIME2      NULL
);

CREATE TABLE api_keys (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    user_id             UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                NVARCHAR(100)  NOT NULL,
    key_prefix          NVARCHAR(12)   NOT NULL,
    key_hash            NVARCHAR(255)  NOT NULL UNIQUE,
    scopes              NVARCHAR(MAX)  NULL,          -- JSON array
    last_used_at        DATETIME2      NULL,
    expires_at          DATETIME2      NULL,
    revoked_at          DATETIME2      NULL,
    created_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
```

### 2.2 Workspaces (Teams)

```sql
CREATE TABLE workspaces (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    name                NVARCHAR(150)  NOT NULL,
    slug                NVARCHAR(100)  NOT NULL UNIQUE,
    owner_id            UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
    logo_url            NVARCHAR(500)  NULL,
    plan                NVARCHAR(30)   NOT NULL DEFAULT 'free',   -- free | pro | team
    created_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    deleted_at          DATETIME2      NULL
);

CREATE TABLE workspace_members (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    workspace_id        UNIQUEIDENTIFIER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id             UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role                NVARCHAR(20)   NOT NULL DEFAULT 'editor', -- owner | admin | editor | viewer
    joined_at           DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT uq_ws_member UNIQUE (workspace_id, user_id)
);

CREATE TABLE workspace_invitations (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    workspace_id        UNIQUEIDENTIFIER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email               NVARCHAR(255)  NOT NULL,
    role                NVARCHAR(20)   NOT NULL DEFAULT 'editor',
    token_hash          NVARCHAR(255)  NOT NULL UNIQUE,
    invited_by          UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
    status              NVARCHAR(20)   NOT NULL DEFAULT 'pending', -- pending | accepted | revoked | expired
    expires_at          DATETIME2      NOT NULL,
    created_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
```

### 2.3 Folders & Diagrams

```sql
CREATE TABLE folders (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    workspace_id        UNIQUEIDENTIFIER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    parent_id           UNIQUEIDENTIFIER NULL REFERENCES folders(id),
    name                NVARCHAR(150)  NOT NULL,
    created_by          UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
    created_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    deleted_at          DATETIME2      NULL
);

CREATE TABLE diagrams (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    workspace_id        UNIQUEIDENTIFIER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    folder_id           UNIQUEIDENTIFIER NULL REFERENCES folders(id),
    name                NVARCHAR(200)  NOT NULL,
    description         NVARCHAR(1000) NULL,
    database_type       NVARCHAR(20)   NOT NULL,      -- mysql | postgresql | mssql | sqlite | oracle | mariadb
    thumbnail_url       NVARCHAR(500)  NULL,
    canvas_settings     NVARCHAR(MAX)  NULL,          -- JSON: zoom, pan, grid, theme, line_style, show_types
    is_starred          BIT            NOT NULL DEFAULT 0,
    is_archived         BIT            NOT NULL DEFAULT 0,
    current_version     INT            NOT NULL DEFAULT 1,
    created_by          UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
    created_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    deleted_at          DATETIME2      NULL
);
CREATE INDEX ix_diagrams_workspace ON diagrams(workspace_id, deleted_at);

CREATE TABLE diagram_collaborators (          -- per-diagram overrides on top of workspace role
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    diagram_id          UNIQUEIDENTIFIER NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    user_id             UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role                NVARCHAR(20)   NOT NULL DEFAULT 'viewer',  -- editor | viewer | commenter
    CONSTRAINT uq_diag_collab UNIQUE (diagram_id, user_id)
);
```

### 2.4 Diagram Content (the core)

```sql
CREATE TABLE diagram_tables (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    diagram_id          UNIQUEIDENTIFIER NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    name                NVARCHAR(128)  NOT NULL,
    schema_name         NVARCHAR(128)  NULL,
    comment             NVARCHAR(1000) NULL,
    color               NVARCHAR(9)    NULL,          -- #RRGGBB(AA)
    pos_x               FLOAT          NOT NULL DEFAULT 0,
    pos_y               FLOAT          NOT NULL DEFAULT 0,
    width               FLOAT          NULL,
    z_index             INT            NOT NULL DEFAULT 0,
    is_collapsed        BIT            NOT NULL DEFAULT 0,
    is_locked           BIT            NOT NULL DEFAULT 0,
    area_id             UNIQUEIDENTIFIER NULL,        -- FK added after diagram_areas
    created_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    deleted_at          DATETIME2      NULL
);
CREATE INDEX ix_tables_diagram ON diagram_tables(diagram_id);

CREATE TABLE diagram_columns (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    table_id            UNIQUEIDENTIFIER NOT NULL REFERENCES diagram_tables(id) ON DELETE CASCADE,
    name                NVARCHAR(128)  NOT NULL,
    data_type           NVARCHAR(50)   NOT NULL,      -- INT, VARCHAR, UUID, DECIMAL, ...
    length              INT            NULL,
    precision           INT            NULL,
    scale               INT            NULL,
    enum_values         NVARCHAR(MAX)  NULL,          -- JSON array for ENUM
    is_primary_key      BIT            NOT NULL DEFAULT 0,
    is_nullable         BIT            NOT NULL DEFAULT 1,
    is_unique           BIT            NOT NULL DEFAULT 0,
    is_auto_increment   BIT            NOT NULL DEFAULT 0,
    is_unsigned         BIT            NOT NULL DEFAULT 0,
    default_value       NVARCHAR(500)  NULL,
    check_expression    NVARCHAR(500)  NULL,
    comment             NVARCHAR(1000) NULL,
    ordinal_position    INT            NOT NULL,
    created_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT uq_col_name UNIQUE (table_id, name)
);

CREATE TABLE diagram_relationships (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    diagram_id          UNIQUEIDENTIFIER NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    name                NVARCHAR(128)  NULL,          -- constraint name
    source_table_id     UNIQUEIDENTIFIER NOT NULL REFERENCES diagram_tables(id),
    source_column_id    UNIQUEIDENTIFIER NOT NULL REFERENCES diagram_columns(id),
    target_table_id     UNIQUEIDENTIFIER NOT NULL REFERENCES diagram_tables(id),
    target_column_id    UNIQUEIDENTIFIER NOT NULL REFERENCES diagram_columns(id),
    cardinality         NVARCHAR(20)   NOT NULL DEFAULT 'one_to_many', -- one_to_one | one_to_many | many_to_many
    on_delete           NVARCHAR(20)   NOT NULL DEFAULT 'NO ACTION',   -- CASCADE | SET NULL | SET DEFAULT | RESTRICT | NO ACTION
    on_update           NVARCHAR(20)   NOT NULL DEFAULT 'NO ACTION',
    line_style          NVARCHAR(20)   NULL,          -- straight | curved | orthogonal
    color               NVARCHAR(9)    NULL,
    label               NVARCHAR(100)  NULL,
    created_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
-- NO ACTION on the table/column FKs avoids MSSQL "multiple cascade paths" errors;
-- cascade cleanup is handled in the service layer.

CREATE TABLE diagram_indexes (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    table_id            UNIQUEIDENTIFIER NOT NULL REFERENCES diagram_tables(id) ON DELETE CASCADE,
    name                NVARCHAR(128)  NOT NULL,
    index_type          NVARCHAR(20)   NOT NULL DEFAULT 'INDEX',  -- INDEX | UNIQUE | FULLTEXT | SPATIAL
    method              NVARCHAR(20)   NULL,                      -- BTREE | HASH | GIN | GIST
    comment             NVARCHAR(500)  NULL
);

CREATE TABLE diagram_index_columns (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    index_id            UNIQUEIDENTIFIER NOT NULL REFERENCES diagram_indexes(id) ON DELETE CASCADE,
    column_id           UNIQUEIDENTIFIER NOT NULL REFERENCES diagram_columns(id),
    sort_order          NVARCHAR(4)    NOT NULL DEFAULT 'ASC',
    position            INT            NOT NULL
);

CREATE TABLE diagram_areas (                   -- "subject areas" / grouping rectangles
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    diagram_id          UNIQUEIDENTIFIER NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    name                NVARCHAR(150)  NOT NULL,
    color               NVARCHAR(9)    NULL,
    pos_x               FLOAT          NOT NULL,
    pos_y               FLOAT          NOT NULL,
    width               FLOAT          NOT NULL,
    height              FLOAT          NOT NULL,
    z_index             INT            NOT NULL DEFAULT 0
);
ALTER TABLE diagram_tables ADD CONSTRAINT fk_tables_area
    FOREIGN KEY (area_id) REFERENCES diagram_areas(id) ON DELETE SET NULL;

CREATE TABLE diagram_notes (                   -- sticky notes on canvas
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    diagram_id          UNIQUEIDENTIFIER NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    content             NVARCHAR(MAX)  NOT NULL,
    color               NVARCHAR(9)    NULL,
    pos_x               FLOAT          NOT NULL,
    pos_y               FLOAT          NOT NULL,
    width               FLOAT          NULL,
    height              FLOAT          NULL,
    created_by          UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
    created_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
```

### 2.5 Versions, Comments, Sharing

```sql
CREATE TABLE diagram_versions (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    diagram_id          UNIQUEIDENTIFIER NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    version_number      INT            NOT NULL,
    label               NVARCHAR(150)  NULL,
    snapshot            NVARCHAR(MAX)  NOT NULL,      -- full JSON of tables/columns/rels/indexes/areas/notes
    created_by          UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
    created_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT uq_diag_version UNIQUE (diagram_id, version_number)
);

CREATE TABLE diagram_comments (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    diagram_id          UNIQUEIDENTIFIER NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    table_id            UNIQUEIDENTIFIER NULL REFERENCES diagram_tables(id),
    parent_id           UNIQUEIDENTIFIER NULL REFERENCES diagram_comments(id),
    author_id           UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
    body                NVARCHAR(MAX)  NOT NULL,
    pos_x               FLOAT          NULL,
    pos_y               FLOAT          NULL,
    is_resolved         BIT            NOT NULL DEFAULT 0,
    created_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    deleted_at          DATETIME2      NULL
);

CREATE TABLE share_links (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    diagram_id          UNIQUEIDENTIFIER NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    token               NVARCHAR(64)   NOT NULL UNIQUE,
    access_level        NVARCHAR(20)   NOT NULL DEFAULT 'view',   -- view | comment
    password_hash       NVARCHAR(255)  NULL,
    expires_at          DATETIME2      NULL,
    is_active           BIT            NOT NULL DEFAULT 1,
    view_count          INT            NOT NULL DEFAULT 0,
    created_by          UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
    created_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
```

### 2.6 Import/Export, Templates, Audit

```sql
CREATE TABLE import_jobs (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    diagram_id          UNIQUEIDENTIFIER NULL REFERENCES diagrams(id),
    workspace_id        UNIQUEIDENTIFIER NOT NULL REFERENCES workspaces(id),
    source_type         NVARCHAR(30)   NOT NULL,      -- sql_ddl | dbml | json | csv | connection
    dialect             NVARCHAR(20)   NULL,
    status              NVARCHAR(20)   NOT NULL DEFAULT 'pending', -- pending | processing | done | failed
    error_message       NVARCHAR(MAX)  NULL,
    created_by          UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
    created_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    completed_at        DATETIME2      NULL
);

CREATE TABLE export_jobs (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    diagram_id          UNIQUEIDENTIFIER NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    format              NVARCHAR(20)   NOT NULL,      -- sql | png | svg | pdf | json | dbml | laravel | django | prisma | sqlalchemy
    dialect             NVARCHAR(20)   NULL,
    status              NVARCHAR(20)   NOT NULL DEFAULT 'pending',
    file_url            NVARCHAR(500)  NULL,
    created_by          UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
    created_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    expires_at          DATETIME2      NULL
);

CREATE TABLE templates (
    id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    name                NVARCHAR(150)  NOT NULL,
    description         NVARCHAR(1000) NULL,
    category            NVARCHAR(50)   NULL,          -- e-commerce | blog | saas | hrms ...
    database_type       NVARCHAR(20)   NOT NULL,
    snapshot            NVARCHAR(MAX)  NOT NULL,
    thumbnail_url       NVARCHAR(500)  NULL,
    is_public           BIT            NOT NULL DEFAULT 1,
    workspace_id        UNIQUEIDENTIFIER NULL REFERENCES workspaces(id),
    created_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE data_type_catalog (               -- allowed types per DB dialect (drives column-type dropdown)
    id                  INT IDENTITY PRIMARY KEY,
    database_type       NVARCHAR(20)   NOT NULL,
    type_name           NVARCHAR(50)   NOT NULL,
    category            NVARCHAR(30)   NULL,          -- numeric | string | date | binary | json | other
    supports_length     BIT            NOT NULL DEFAULT 0,
    supports_precision  BIT            NOT NULL DEFAULT 0,
    CONSTRAINT uq_type UNIQUE (database_type, type_name)
);

CREATE TABLE audit_logs (
    id                  BIGINT IDENTITY PRIMARY KEY,
    workspace_id        UNIQUEIDENTIFIER NULL,
    diagram_id          UNIQUEIDENTIFIER NULL,
    user_id             UNIQUEIDENTIFIER NULL,
    action              NVARCHAR(60)   NOT NULL,      -- table.create, column.update, diagram.share ...
    entity_type         NVARCHAR(40)   NULL,
    entity_id           UNIQUEIDENTIFIER NULL,
    changes             NVARCHAR(MAX)  NULL,          -- JSON diff
    ip_address          NVARCHAR(45)   NULL,
    created_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX ix_audit_diagram ON audit_logs(diagram_id, created_at DESC);
```

### 2.7 Table Overview

| Group | Tables |
|---|---|
| Auth | `users`, `oauth_accounts`, `refresh_tokens`, `password_reset_tokens`, `email_verification_tokens`, `api_keys` |
| Workspace | `workspaces`, `workspace_members`, `workspace_invitations` |
| Organization | `folders`, `diagrams`, `diagram_collaborators` |
| Canvas content | `diagram_tables`, `diagram_columns`, `diagram_relationships`, `diagram_indexes`, `diagram_index_columns`, `diagram_areas`, `diagram_notes` |
| Collaboration | `diagram_versions`, `diagram_comments`, `share_links` |
| Tooling | `import_jobs`, `export_jobs`, `templates`, `data_type_catalog`, `audit_logs` |

---

## 3. API Endpoints

Legend: 🔒 = auth required · 👁 = viewer+ · ✏️ = editor+ · 👑 = admin/owner

### 3.1 Auth — `/api/v1/auth`

| Method | Path | Description |
|---|---|---|
| POST | `/register` | Create account (email, password, full_name) |
| POST | `/login` | Returns access + refresh token |
| POST | `/refresh` | Rotate refresh token |
| POST | `/logout` 🔒 | Revoke current refresh token |
| POST | `/logout-all` 🔒 | Revoke all sessions |
| POST | `/forgot-password` | Send reset email |
| POST | `/reset-password` | Reset with token |
| POST | `/verify-email` | Verify with token |
| POST | `/resend-verification` | Resend verification email |
| GET | `/oauth/{provider}/login` | Redirect to Google/GitHub |
| GET | `/oauth/{provider}/callback` | OAuth callback |
| POST | `/change-password` 🔒 | Change password |

### 3.2 Users — `/api/v1/users`

| Method | Path | Description |
|---|---|---|
| GET | `/me` 🔒 | Current profile |
| PATCH | `/me` 🔒 | Update name / avatar |
| DELETE | `/me` 🔒 | Delete account (soft) |
| GET | `/me/sessions` 🔒 | List active sessions |
| DELETE | `/me/sessions/{id}` 🔒 | Revoke session |
| GET | `/me/api-keys` 🔒 | List API keys |
| POST | `/me/api-keys` 🔒 | Create API key (secret shown once) |
| DELETE | `/me/api-keys/{id}` 🔒 | Revoke API key |
| GET | `/search?q=` 🔒 | Search users (for invites) |

### 3.3 Workspaces — `/api/v1/workspaces`

| Method | Path | Description |
|---|---|---|
| GET | `/` 🔒 | My workspaces |
| POST | `/` 🔒 | Create workspace |
| GET | `/{ws_id}` 👁 | Get workspace |
| PATCH | `/{ws_id}` 👑 | Update name/logo |
| DELETE | `/{ws_id}` 👑 | Delete workspace |
| GET | `/{ws_id}/members` 👁 | List members |
| PATCH | `/{ws_id}/members/{user_id}` 👑 | Change role |
| DELETE | `/{ws_id}/members/{user_id}` 👑 | Remove member / leave |
| GET | `/{ws_id}/invitations` 👑 | List invitations |
| POST | `/{ws_id}/invitations` 👑 | Invite by email |
| DELETE | `/{ws_id}/invitations/{id}` 👑 | Revoke invite |
| POST | `/invitations/accept` 🔒 | Accept invite (token) |
| POST | `/{ws_id}/transfer-ownership` 👑 | Transfer ownership |
| GET | `/{ws_id}/audit-logs` 👑 | Workspace activity |

### 3.4 Folders — `/api/v1/workspaces/{ws_id}/folders`

| Method | Path | Description |
|---|---|---|
| GET | `/` 👁 | Folder tree |
| POST | `/` ✏️ | Create folder |
| PATCH | `/{folder_id}` ✏️ | Rename / move |
| DELETE | `/{folder_id}` ✏️ | Delete folder |

### 3.5 Diagrams — `/api/v1`

| Method | Path | Description |
|---|---|---|
| GET | `/workspaces/{ws_id}/diagrams` 👁 | List (filters: folder, starred, archived, q) |
| POST | `/workspaces/{ws_id}/diagrams` ✏️ | Create diagram |
| POST | `/workspaces/{ws_id}/diagrams/from-template/{template_id}` ✏️ | Create from template |
| GET | `/diagrams/{id}` 👁 | Metadata only |
| GET | `/diagrams/{id}/full` 👁 | **Full canvas payload** (tables + columns + rels + indexes + areas + notes) |
| PATCH | `/diagrams/{id}` ✏️ | Update name/description/db type/canvas settings |
| DELETE | `/diagrams/{id}` ✏️ | Soft delete |
| POST | `/diagrams/{id}/restore` ✏️ | Restore from trash |
| POST | `/diagrams/{id}/duplicate` ✏️ | Duplicate |
| POST | `/diagrams/{id}/move` ✏️ | Move to folder / workspace |
| POST | `/diagrams/{id}/star` · DELETE `/star` 🔒 | Star / unstar |
| POST | `/diagrams/{id}/archive` · `/unarchive` ✏️ | Archive |
| PUT | `/diagrams/{id}/thumbnail` ✏️ | Upload thumbnail |
| GET | `/diagrams/{id}/stats` 👁 | Counts (tables, columns, relationships) |
| GET | `/diagrams/{id}/audit-logs` 👁 | Change history |
| GET | `/diagrams/{id}/collaborators` 👁 | List collaborators |
| POST | `/diagrams/{id}/collaborators` 👑 | Add collaborator |
| PATCH | `/diagrams/{id}/collaborators/{user_id}` 👑 | Change role |
| DELETE | `/diagrams/{id}/collaborators/{user_id}` 👑 | Remove |
| GET | `/diagrams/trash` 🔒 | Deleted diagrams |

### 3.6 Tables — `/api/v1/diagrams/{id}/tables`

| Method | Path | Description |
|---|---|---|
| GET | `/` 👁 | List tables (with columns) |
| POST | `/` ✏️ | Create table (optionally with columns) |
| GET | `/{table_id}` 👁 | Get table |
| PATCH | `/{table_id}` ✏️ | Rename, color, comment, schema |
| DELETE | `/{table_id}` ✏️ | Delete (also removes its relationships) |
| PATCH | `/{table_id}/position` ✏️ | Move on canvas (`x`, `y`) — high frequency |
| PATCH | `/positions` ✏️ | **Bulk position update** (drag multiple) |
| POST | `/{table_id}/duplicate` ✏️ | Duplicate table |
| POST | `/{table_id}/lock` · `/unlock` ✏️ | Lock position |
| POST | `/{table_id}/collapse` · `/expand` ✏️ | Toggle |
| PATCH | `/{table_id}/z-index` ✏️ | Bring to front / send back |
| POST | `/bulk` ✏️ | Bulk create |
| DELETE | `/bulk` ✏️ | Bulk delete (`ids[]`) |
| POST | `/{table_id}/sql` 👁 | Generate `CREATE TABLE` for one table |

### 3.7 Columns — `/api/v1/diagrams/{id}/tables/{table_id}/columns`

| Method | Path | Description |
|---|---|---|
| GET | `/` 👁 | List columns (ordered) |
| POST | `/` ✏️ | Add column |
| POST | `/bulk` ✏️ | Add many columns |
| GET | `/{column_id}` 👁 | Get column |
| PATCH | `/{column_id}` ✏️ | Update (name, type, nullable, PK, default, …) |
| DELETE | `/{column_id}` ✏️ | Delete (blocked or cascades if used in relationship/index — return 409 with usage) |
| PUT | `/reorder` ✏️ | Reorder (`ordered_ids[]`) |
| POST | `/{column_id}/duplicate` ✏️ | Duplicate column |
| GET | `/{column_id}/usages` 👁 | Relationships/indexes referencing this column |

### 3.8 Relationships — `/api/v1/diagrams/{id}/relationships`

| Method | Path | Description |
|---|---|---|
| GET | `/` 👁 | List all |
| POST | `/` ✏️ | Create (validates type compatibility of source/target columns) |
| GET | `/{rel_id}` 👁 | Get |
| PATCH | `/{rel_id}` ✏️ | Update cardinality, on_delete/on_update, style, label |
| DELETE | `/{rel_id}` ✏️ | Delete |
| GET | `/by-table/{table_id}` 👁 | Relationships touching a table |
| POST | `/validate` ✏️ | Dry-run validation (type mismatch, cycles, missing PK) |
| POST | `/auto-detect` ✏️ | Suggest relationships from naming (`user_id` → `users.id`) |

### 3.9 Indexes — `/api/v1/diagrams/{id}/tables/{table_id}/indexes`

| Method | Path | Description |
|---|---|---|
| GET | `/` 👁 | List |
| POST | `/` ✏️ | Create (name, type, columns[]) |
| PATCH | `/{index_id}` ✏️ | Update |
| DELETE | `/{index_id}` ✏️ | Delete |

### 3.10 Areas & Notes — `/api/v1/diagrams/{id}`

| Method | Path | Description |
|---|---|---|
| GET/POST | `/areas` | List / create area |
| PATCH/DELETE | `/areas/{area_id}` | Update (move/resize/rename) / delete |
| GET/POST | `/notes` | List / create note |
| PATCH/DELETE | `/notes/{note_id}` | Update / delete |

### 3.11 Batch / Sync (recommended for canvas performance)

| Method | Path | Description |
|---|---|---|
| POST | `/diagrams/{id}/batch` ✏️ | Apply array of operations in **one transaction** (`create_table`, `update_column`, `delete_relationship`, …) |
| GET | `/diagrams/{id}/changes?since=<ts or version>` 👁 | Delta sync |
| PUT | `/diagrams/{id}/full` ✏️ | Replace entire canvas (used by import/restore) |
| POST | `/diagrams/{id}/undo` · `/redo` ✏️ | Server-side undo stack (optional) |

Batch payload example:

```json
{
  "base_version": 12,
  "operations": [
    { "op": "create_table", "temp_id": "t1", "data": { "name": "orders", "pos_x": 120, "pos_y": 80 } },
    { "op": "create_column", "table_id": "$t1", "data": { "name": "id", "data_type": "UUID", "is_primary_key": true, "is_nullable": false } },
    { "op": "update_table_position", "id": "…", "data": { "pos_x": 300, "pos_y": 200 } },
    { "op": "delete_relationship", "id": "…" }
  ]
}
```

### 3.12 Versions — `/api/v1/diagrams/{id}/versions`

| Method | Path | Description |
|---|---|---|
| GET | `/` 👁 | List versions |
| POST | `/` ✏️ | Save named snapshot |
| GET | `/{version_id}` 👁 | Get snapshot |
| POST | `/{version_id}/restore` ✏️ | Restore |
| DELETE | `/{version_id}` ✏️ | Delete |
| GET | `/compare?from=&to=` 👁 | Diff (tables/columns added/removed/changed) |
| GET | `/{version_id}/migration-sql` 👁 | ALTER script from previous → this version |

### 3.13 Comments — `/api/v1/diagrams/{id}/comments`

| Method | Path | Description |
|---|---|---|
| GET | `/` 👁 | List (filter: table_id, resolved) |
| POST | `/` commenter+ | Add comment / reply (`parent_id`) |
| PATCH | `/{comment_id}` author | Edit |
| DELETE | `/{comment_id}` author/admin | Delete |
| POST | `/{comment_id}/resolve` · `/unresolve` commenter+ | Toggle resolved |

### 3.14 Sharing — `/api/v1`

| Method | Path | Description |
|---|---|---|
| GET | `/diagrams/{id}/share-links` 👑 | List links |
| POST | `/diagrams/{id}/share-links` 👑 | Create (access level, password, expiry) |
| PATCH | `/diagrams/{id}/share-links/{link_id}` 👑 | Update / disable |
| DELETE | `/diagrams/{id}/share-links/{link_id}` 👑 | Delete |
| GET | `/public/{token}` | **Public** — get shared diagram (no auth) |
| POST | `/public/{token}/unlock` | Submit password for protected link |
| GET | `/public/{token}/comments` · POST | Public comments (if `comment` access) |
| GET | `/public/{token}/embed` | Embeddable view (iframe) |

### 3.15 Import — `/api/v1/import`

| Method | Path | Description |
|---|---|---|
| POST | `/sql` ✏️ | Parse `CREATE TABLE` DDL (dialect param) → diagram |
| POST | `/dbml` ✏️ | Import DBML |
| POST | `/json` ✏️ | Import JSON schema / own export |
| POST | `/file` ✏️ | Upload `.sql` / `.json` / `.dbml` (multipart) |
| POST | `/connection` ✏️ | Reverse-engineer from live DB connection string (read `INFORMATION_SCHEMA`; never store credentials) |
| POST | `/preview` ✏️ | Parse only, return result without saving |
| GET | `/jobs/{job_id}` ✏️ | Job status (large imports) |

### 3.16 Export — `/api/v1/diagrams/{id}/export`

| Method | Path | Description |
|---|---|---|
| GET | `/sql?dialect=mssql` 👁 | `CREATE TABLE` + FK + index script |
| GET | `/sql/migration?from_version=` 👁 | ALTER-style diff script |
| GET | `/dbml` 👁 | DBML |
| GET | `/json` 👁 | Native JSON |
| GET | `/png` · `/svg` · `/pdf` 👁 | Image / PDF (headless render, may be async job) |
| GET | `/orm/{target}` 👁 | `sqlalchemy` \| `prisma` \| `typeorm` \| `django` \| `laravel` \| `sequelize` models |
| GET | `/docs` 👁 | Markdown data dictionary of all tables |
| POST | `/jobs` 👁 | Create async export job |
| GET | `/jobs/{job_id}` 👁 | Job status / download URL |

### 3.17 Templates — `/api/v1/templates`

| Method | Path | Description |
|---|---|---|
| GET | `/` | Public templates (filter: category, database_type) |
| GET | `/{id}` | Template detail |
| POST | `/` 🔒 | Save diagram as template |
| DELETE | `/{id}` 🔒 | Delete own template |

### 3.18 Meta / Utility

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/meta/database-types` | Supported dialects |
| GET | `/api/v1/meta/data-types?database_type=mssql` | Types for column dropdown |
| GET | `/api/v1/meta/relationship-options` | Cardinalities, ON DELETE options |
| POST | `/api/v1/sql/validate` | Validate DDL syntax |
| POST | `/api/v1/sql/generate` | Generate DDL from posted JSON (stateless) |
| GET | `/api/v1/search?q=` 🔒 | Search diagrams / tables / columns |
| GET | `/health` | Liveness |
| GET | `/health/db` | DB connectivity |

### 3.19 Real-time (WebSocket)

| Path | Description |
|---|---|
| `WS /ws/diagrams/{id}?token=<jwt>` | Live collaboration channel |

Event types (JSON messages):

- Server → client: `presence.join`, `presence.leave`, `cursor.move`, `table.created`, `table.updated`, `table.deleted`, `column.*`, `relationship.*`, `comment.created`, `version.saved`
- Client → server: `cursor.move`, `selection.change`, plus any batch operation (server validates, persists, then broadcasts)
- Conflict strategy: last-write-wins per field, using `base_version` and per-entity `updated_at`

---

## 4. Permissions Matrix

| Action | Owner | Admin | Editor | Commenter | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| View diagram | ✅ | ✅ | ✅ | ✅ | ✅ |
| Comment | ✅ | ✅ | ✅ | ✅ | ❌ |
| Edit tables/columns/relationships | ✅ | ✅ | ✅ | ❌ | ❌ |
| Create/delete diagrams | ✅ | ✅ | ✅ | ❌ | ❌ |
| Manage share links | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage members | ✅ | ✅ | ❌ | ❌ | ❌ |
| Delete workspace | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## 5. MSSQL + FastAPI Notes

- **Driver:** `pyodbc` with *ODBC Driver 18 for SQL Server*; connection string
  `mssql+pyodbc://user:pass@host/db?driver=ODBC+Driver+18+for+SQL+Server&TrustServerCertificate=yes`
- **Async:** SQLAlchemy async isn't native for pyodbc — use `aioodbc` (`mssql+aioodbc://`) or run sync sessions in a threadpool (`def` endpoints).
- **Cascade paths:** MSSQL rejects multiple cascade paths — use `ON DELETE NO ACTION` for relationship FKs and clean up in the service layer.
- **JSON columns:** store as `NVARCHAR(MAX)` and validate with `ISJSON()` (optional CHECK constraint).
- **Reserved words:** table/column names in generated SQL must be wrapped in `[brackets]`.
- **Concurrency:** add a `rowversion` column (or use `updated_at`) on `diagrams`, `diagram_tables` for optimistic locking.
- **Migrations:** Alembic; keep `data_type_catalog` seeded via a migration.
- **Bulk position updates:** use a single `UPDATE ... FROM (VALUES ...)` statement instead of N updates.
- **Snapshots:** version snapshots can get large — compress (gzip → `VARBINARY(MAX)`) if needed.

---

## 6. Suggested Build Order

1. Auth + users → workspaces + members
2. Diagrams + folders (CRUD)
3. Tables + columns (core canvas) → `GET /diagrams/{id}/full`
4. Relationships + indexes
5. **SQL export** (DDL generator) and **SQL import** (DDL parser, e.g. `sqlglot`)
6. Batch endpoint + versions
7. Sharing + public view
8. Comments + WebSocket collaboration
9. PNG/SVG/PDF export, templates, ORM export, API keys