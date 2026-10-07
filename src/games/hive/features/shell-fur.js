import * as THREE from 'three';

// "Shells" fur, as in real-time fur demos: the surface is drawn again a few times, each copy pushed a
// little further out along its normals, and a strand pattern cuts holes into every layer so only thin
// hairs remain (thick at the root, thin at the tip). All layers are one instanced draw call and use
// the standard lit material, so light, fog, and shadows match the rest of the garden.
//
// `stripes` colours fur by position along the body's z axis (honeybee bands); otherwise the
// geometry's vertex colours or `color` are used.
export function createShellFur(source, { layers = 12, length = 0.08, density = [60, 30], color = '#ffffff', stripes = null, rootShade = 0.5, droop = 0.3, roughness = 0.95 } = {}) {
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) if (source.attributes[name]) geometry.setAttribute(name, source.attributes[name]);
  geometry.setAttribute('furUv', source.attributes.uv); geometry.setIndex(source.index);
  const count = { value: layers };
  const vertexColors = !stripes && !!source.attributes.color;
  const material = new THREE.MeshStandardMaterial({ color, roughness, vertexColors });
  const bands = stripes ?? [];
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { furCount: count, furLength: { value: length }, furDensity: { value: new THREE.Vector2(...density) }, furDroop: { value: droop }, furRoot: { value: rootShade } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 furUv; uniform float furCount; uniform float furLength; uniform float furDroop; varying float vFurLayer; varying vec2 vFurUv; varying float vFurZ;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // Layers spread over the full fur length whatever their count, so fewer layers keep long hair.
        float furLayer = float(gl_InstanceID + 1) / furCount;
        vFurLayer = furLayer; vFurUv = furUv; vFurZ = position.z;
        transformed += normalize(objectNormal) * furLength * furLayer;
        transformed.y -= furDroop * furLength * furLayer * furLayer; // tips sag a little`);
    const stripeCode = bands.map(b => `furTint = mix(furTint, vec3(${new THREE.Color(b.color).toArray().map(v => v.toFixed(3)).join(', ')}), 1.0 - smoothstep(${(b.width * 0.75).toFixed(3)}, ${b.width.toFixed(3)}, abs(vFurZ - (${b.z.toFixed(3)}))));`).join('\n');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec2 furDensity; uniform float furRoot; varying float vFurLayer; varying vec2 vFurUv; varying float vFurZ;
        float furHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        vec2 furCell = vFurUv * furDensity, furId = floor(furCell);
        float furStrand = furHash(furId), furTip = 0.25 + 0.75 * furHash(furId + 17.0);
        vec2 furLocal = fract(furCell) - 0.5 + (vec2(furHash(furId + 3.0), furHash(furId + 9.0)) - 0.5) * 0.4;
        // Each strand gets thinner towards its tip and has its own length; empty space is cut away.
        if (vFurLayer > furTip || length(furLocal) > 0.48 * (1.0 - vFurLayer / furTip) * (0.55 + 0.45 * furStrand)) discard;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 furTint = diffuseColor.rgb;
        ${stripeCode}
        diffuseColor.rgb = furTint * mix(furRoot, 1.0, vFurLayer); // darker near the skin, like real fur`)
      // Soft sheen on the outer layers, a cheap stand-in for the anisotropic highlight of real hair.
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n        totalEmissiveRadiance += diffuseColor.rgb * 0.18 * smoothstep(0.55, 1.0, vFurLayer);');
  };
  material.customProgramCacheKey = () => `shell-fur:${stripes ? JSON.stringify(stripes) : 'vc'}`;
  const mesh = new THREE.InstancedMesh(geometry, material, layers);
  for (let i = 0; i < layers; i++) mesh.setMatrixAt(i, new THREE.Matrix4());
  mesh.castShadow = false; mesh.receiveShadow = false; mesh.name = 'shell-fur';
  // Level of detail: draw fewer, more widely spaced layers (or none) without rebuilding anything.
  mesh.userData.setLayers = n => { n = Math.max(0, Math.min(layers, Math.round(n))); mesh.count = n; mesh.visible = n > 0; if (n) count.value = n; };
  return mesh;
}
