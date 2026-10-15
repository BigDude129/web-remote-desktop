let csrfToken = '';
export function setCsrf(value: string) {
  csrfToken = value;
}
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: '서버에 연결하지 못했습니다.' }));
    if (response.status === 401 && path !== '/auth/login')
      window.dispatchEvent(new Event('desklink:unauthorized'));
    throw new ApiError(body.error ?? '요청에 실패했습니다.', response.status);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
