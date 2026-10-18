/** A transport-only dispatcher. No upstream body or credential leaves this boundary. */
export function createPublicationDispatcher({ env = {}, fetchImpl = globalThis.fetch } = {}) {
  const token = String(env.PPC_GITHUB_DISPATCH_TOKEN || '').trim();
  const owner = env.PPC_GITHUB_OWNER || 'monocraft', repo = env.PPC_GITHUB_REPO || 'PPC';
  const workflow = env.PPC_GITHUB_PUBLISH_WORKFLOW || 'publish-master.yml';
  function canDispatch({ fixed = false } = {}) {
    return Boolean(token && /^[A-Za-z0-9_.-]+$/.test(owner) && /^[A-Za-z0-9_.-]+$/.test(repo)
      && /^[A-Za-z0-9_.-]+\.ya?ml$/.test(workflow)
      && (!fixed || owner === 'monocraft' && repo === 'PPC' && workflow === 'publish-master.yml'));
  }
  async function dispatch({ fixed = false, imagesCommit = '' } = {}) {
    if (!canDispatch({ fixed }) || fixed && imagesCommit !== '' && !/^[a-f0-9]{40}$/.test(imagesCommit)) return 'failed';
    try {
      const result = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
        body: JSON.stringify({ ref: 'main', ...(fixed ? { inputs: { bootstrap: false, images_commit: imagesCommit, seed_delivery_cache: false } } : {}) }),
      });
      await result.body?.cancel().catch(() => {});
      if (result.redirected) return 'uncertain';
      if (result.ok) return 'accepted';
      return result.status >= 400 && result.status < 500 && ![408, 429].includes(result.status) ? 'failed' : 'uncertain';
    } catch { return 'uncertain'; }
  }
  return Object.freeze({ canDispatch, dispatch });
}
