// Retry reads only: a failed POST response may still have committed its result.
export async function breadthRequest(url: string, init: RequestInit = {}): Promise<Response> {
  const read = !init.method || init.method === 'GET';
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {...init, cache: 'no-store', signal: AbortSignal.timeout(read ? 20000 : 30000)});
      if (read && attempt === 0 && [502,504].includes(response.status)) {
        await response.body?.cancel();
        continue;
      }
      if (response.status === 401 || response.redirected) throw new Error('登录状态已失效，请重新打开网站登录后重试。');
      return response;
    } catch (error) {
      const network = error instanceof TypeError || (error instanceof Error && ['TimeoutError','AbortError'].includes(error.name));
      if (read && attempt === 0 && network) continue;
      if (network) throw new Error(read
        ? '连接市场宽度服务失败，自动重试后仍未恢复。请检查网络后重试；已有有效数据会继续保留。'
        : '刷新结果暂未确认，请先重新读取数据，避免重复提交；已有有效数据会继续保留。');
      throw error;
    }
  }
}
