// Files in public/ (NASA clips, voice, sounds, fonts...) resolved against wherever the site is
// served from: the root of a custom domain, or a sub-path like username.github.io/repo/.
export const asset = (path: string) => import.meta.env.BASE_URL + path.replace(/^\//, '');
