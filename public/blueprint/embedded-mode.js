/* Apply the host layout before styles are painted. */
document.documentElement.dataset.embedded = String(new URLSearchParams(location.search).get('embedded') === '1');
