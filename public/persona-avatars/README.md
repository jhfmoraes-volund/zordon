# Persona avatars (mock)

Avatares mock usados no step `personas_journeys` da Design Session.

## Como colocar suas 6 fotos

Coloque 6 arquivos JPG (ou PNG) com esses nomes exatos neste diretorio:

```
persona-1.jpg
persona-2.jpg
persona-3.jpg
persona-4.jpg
persona-5.jpg
persona-6.jpg
```

## Especs

- **Aspect ratio**: 1:1 (quadrado). O componente renderiza a 48x48px com
  `object-cover`, entao o miolo do rosto deve estar centralizado.
- **Tamanho minimo**: 96x96px (2x retina). Maximo razoavel: 256x256px.
- **Formato**: JPG recomendado (ja sao mocks); PNG funciona mas pesa mais.

## Como o mapeamento funciona

`src/components/design-session/persona-avatar.ts` faz hash do `persona.id`
e mapeia em `[1..6]` deterministicamente. Mesma persona sempre puxa a mesma
foto. Trocar de foto = trocar o arquivo (mantendo o nome).
