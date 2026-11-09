/**
 * Filter a bounded, already-sanitized public GitHub repository snapshot.
 * This never makes a new provider request or searches private repositories.
 */
export function filterRepositories(repositories, query = "") {
  if (!Array.isArray(repositories)) return [];
  const term = typeof query === "string" ? query.trim().slice(0, 100).toLowerCase() : "";
  return repositories.filter(repo => repo && typeof repo.name === "string" &&
    (repo.name.toLowerCase().includes(term) ||
      (typeof repo.language === "string" && repo.language.toLowerCase().includes(term))));
}
