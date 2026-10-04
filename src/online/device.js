/**
 * What kind of machine a player is on. Nothing here identifies a person:
 * no IP, no location, no name — just the hardware and software the game is
 * running on, which is exactly what's needed to see who it runs badly for.
 */
export function deviceInfo(renderer) {
  const ua = navigator.userAgent;
  const os =
    /Android/i.test(ua) ? 'Android' :
    /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iOS' :
    /Windows/i.test(ua) ? 'Windows' :
    /Mac OS X|Macintosh/i.test(ua) ? 'macOS' :
    /CrOS/i.test(ua) ? 'ChromeOS' :
    /Linux/i.test(ua) ? 'Linux' : 'Other';
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /OPR\//.test(ua) ? 'Opera' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Safari\//.test(ua) ? 'Safari' : 'Other';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  let gpu = '';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    // "ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 ...)" → the readable part.
    const m = gpu.match(/ANGLE \([^,]*,\s*([^(]+?)\s*(\(0x|Direct3D|OpenGL|Vulkan|Metal|,)/);
    if (m) gpu = m[1].trim();
  } catch { /* some browsers hide it */ }
  return {
    type: mobile ? 'phone/tablet' : 'computer',
    os,
    browser,
    screen: `${screen.width}x${screen.height}`,
    dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
    cores: navigator.hardwareConcurrency || 0,
    memoryGB: navigator.deviceMemory || 0,
    gpu: gpu.slice(0, 80),
    language: navigator.language || '',
    timezone: (Intl.DateTimeFormat().resolvedOptions().timeZone || '').slice(0, 40)
  };
}
