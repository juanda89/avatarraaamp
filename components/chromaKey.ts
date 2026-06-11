/**
 * Chroma key en el cliente: dibuja el stream de video (fondo verde)
 * sobre un canvas WebGL volviendo transparente el verde, con supresión
 * de "spill" en los bordes. Algoritmo estilo OBS (distancia en UV).
 */

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2((a_pos.x + 1.0) * 0.5, (1.0 - a_pos.y) * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;

const vec3 KEY_COLOR = vec3(0.0, 1.0, 0.0);
const float SIMILARITY = 0.36;
const float SMOOTHNESS = 0.08;
const float SPILL = 0.12;

vec2 rgb2uv(vec3 rgb) {
  return vec2(
    rgb.r * -0.169 + rgb.g * -0.331 + rgb.b * 0.5 + 0.5,
    rgb.r * 0.5 + rgb.g * -0.419 + rgb.b * -0.081 + 0.5
  );
}

void main() {
  vec4 c = texture2D(u_tex, v_uv);
  float chromaDist = distance(rgb2uv(c.rgb), rgb2uv(KEY_COLOR));

  float baseMask = chromaDist - SIMILARITY;
  float alpha = pow(clamp(baseMask / SMOOTHNESS, 0.0, 1.0), 1.5);

  float spillMask = pow(clamp(baseMask / SPILL, 0.0, 1.0), 1.5);
  float gray = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  c.rgb = mix(vec3(gray), c.rgb, spillMask);

  gl_FragColor = vec4(c.rgb * alpha, alpha);
}
`;

export function startChromaKey(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): () => void {
  const gl = canvas.getContext("webgl", {
    premultipliedAlpha: true,
    alpha: true,
  });
  if (!gl) throw new Error("WebGL no disponible");

  const compile = (type: number, src: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? "shader error");
    }
    return shader;
  };

  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  gl.useProgram(program);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const aPos = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  let stopped = false;
  let rafId = 0;
  let vfcId = 0;

  const hasVFC = "requestVideoFrameCallback" in video;

  const draw = () => {
    if (stopped) return;
    if (video.readyState >= 2 && video.videoWidth > 0) {
      if (
        canvas.width !== video.videoWidth ||
        canvas.height !== video.videoHeight
      ) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
      }
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        video,
      );
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    if (hasVFC) {
      vfcId = video.requestVideoFrameCallback(draw);
    } else {
      rafId = requestAnimationFrame(draw);
    }
  };

  draw();

  return () => {
    stopped = true;
    if (hasVFC && vfcId) video.cancelVideoFrameCallback(vfcId);
    if (rafId) cancelAnimationFrame(rafId);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
}
