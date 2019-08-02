var sdf_fragment = `#extension GL_EXT_shader_texture_lod : enable
#extension GL_OES_standard_derivatives : enable



precision highp float;
      precision highp int;

uniform sampler2D u_texture;
uniform vec4 u_color;

uniform float u_buffer;
uniform float u_gamma;

varying vec2 v_texcoord;

// void main() {
//     float dist = texture2D(u_texture, v_texcoord).r;
//     float alpha = smoothstep(u_buffer - u_gamma, u_buffer + u_gamma, dist);
//     gl_FragColor = vec4(u_color.rgb, alpha * u_color.a);
// }


float aastep(float value) {
      float afwidth = length(vec2(dFdx(value), dFdy(value))) * 0.70710678118654757;
      return smoothstep(0.5 - afwidth, 0.5 + afwidth, value);
    }


void main() {
// //     float dist = texture2D(u_texture, v_texcoord).r;
// //     float alpha = smoothstep(u_buffer - u_gamma, u_buffer + u_gamma, dist);
// //     gl_FragColor = vec4(u_color.rgb, alpha * u_color.a);



//     vec4 texColor = texture2D(u_texture, v_texcoord);

// //     float alpha = aastep(texColor.a);
// //     float alpha = aastep(texColor.r);
//     float alpha = (texColor.r);

// // float alpha = texColor.a;


// // vec4 u_color = vec4(0.5,0.5,0.5, 1.0);

//     gl_FragColor = vec4(u_color.rgb, alpha);


    float dist = texture2D(u_texture, v_texcoord).r;
//     float dist = texture2D(u_texture, v_texcoord).a;
    float alpha = smoothstep(u_buffer - u_gamma, u_buffer + u_gamma, dist);

// float alpha = dist;
// float alpha = 0.5;

//     gl_FragColor = vec4(u_color.rgb, alpha * u_color.a);
    gl_FragColor = vec4(u_color.rgb, alpha);

}

`