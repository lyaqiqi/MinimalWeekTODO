"""
Supabase client factory — cached singletons for DB and auth operations.
"""

import os
from supabase import create_client, Client

# httpx picks up system proxy settings (HTTP_PROXY / HTTPS_PROXY) which can
# break TLS tunneling to Supabase.  Remove them before the clients are built.
for _var in ('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy',
             'ALL_PROXY', 'all_proxy'):
    os.environ.pop(_var, None)

_db_client: Client | None = None
_anon_client: Client | None = None


def get_db() -> Client:
    """Service-key client — bypasses RLS, used for all backend data ops."""
    global _db_client
    if _db_client is None:
        _db_client = create_client(
            os.environ['SUPABASE_URL'],
            os.environ['SUPABASE_SECRET_KEY'],
        )
    return _db_client


def get_auth() -> Client:
    """Anon-key client — used for sign_up / sign_in / get_user."""
    global _anon_client
    if _anon_client is None:
        _anon_client = create_client(
            os.environ['SUPABASE_URL'],
            os.environ['SUPABASE_ANON_KEY'],
        )
    return _anon_client
