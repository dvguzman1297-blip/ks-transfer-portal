'use client';

import { useEffect } from 'react';

// Email links (confirm sign-up, reset password) can land on "/" with the session in the URL hash.
// Forward them to the portal, which is where the sign-in session is handled.
export default function HashRedirect() {
  useEffect(() => {
    const h = window.location.hash;
    if (/access_token=|type=recovery|error_description=/.test(h)) window.location.replace(`/portal${h}`);
  }, []);
  return null;
}
