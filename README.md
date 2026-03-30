# radar-os

Sistema de captura de senales, contenidos y materiales de aprendizaje dentro de ATENEA v1.

Lee primero [SYSTEM_CONTEXT.md](/Users/raullopezgarcia/pka-v1/radar-os/SYSTEM_CONTEXT.md) para entender como encaja este repositorio dentro del sistema completo.

## Rol

`radar-os` funciona como buzon de entrada para materiales que pueden enriquecer el sistema:

- transcripciones
- notas rapidas
- recursos
- videos
- lecturas
- ideas a revisar

No consolida memoria interpretativa por si mismo.
Su funcion es alimentar `atenea` con evidencia y material pendiente de clasificacion o validacion.

## Estructura minima

```text
radar-os/
  README.md
  SYSTEM_CONTEXT.md
  AGENTS.md
  CLAUDE.md
  scripts/
  transcripts/
  resources/
  notes/
  inbox/
  proposals/
```

## Regla de integracion

Los contenidos capturados aqui deben terminar en `atenea` como:

- `raw_items` cuando sean evidencia o material bruto
- `review_items` cuando impliquen interpretacion, patrones o cambios de criterio

La referencia de integracion es:

[docs/ATENEA_INTEGRATION_CONTRACT.md](/Users/raullopezgarcia/pka-v1/atenea/docs/ATENEA_INTEGRATION_CONTRACT.md)

## Que debe vivir aqui

- transcripciones pendientes de procesar
- recursos y lecturas
- notas de exploracion
- propuestas de temas a revisar
- materiales de entrada para aprendizaje y refinamiento

## Que no debe vivir aqui como verdad final

- memoria validada canónica
- objetivos operativos canónicos
- tareas canónicas
- interpretaciones consolidadas sin pasar por `atenea`

## Agentes locales para video

Se han dejado tres comandos base para procesar videos de YouTube dentro del rol de `radar-os`:

- `radar-os_youtube_transcriber`
- `radar-os_video_summarizer`
- `radar-os_youtube_pipeline`

### 1. `radar-os_youtube_transcriber`

Captura una transcripcion bruta y la guarda en `transcripts/`.

Ejemplo:

```bash
npm run radar-os_youtube_transcriber -- --url "https://www.youtube.com/watch?v=YGof1CfY8IA" --sphere personal --lang en
```

Comportamiento:

- intenta obtener captions del video
- si no existen, intenta fallback ASR con OpenAI
- escribe un markdown con origen, metodo y transcripcion

Requisitos para fallback ASR:

- `yt-dlp` instalado en el sistema
- `OPENAI_API_KEY`
- `OPENAI_TRANSCRIBE_MODEL`

### 2. `radar-os_video_summarizer`

Lee una transcripcion ya guardada, consulta contexto canónico en `atenea` y genera una propuesta de resumen en `proposals/`.

Ejemplo:

```bash
npm run radar-os_video_summarizer -- --input transcripts/archivo.md --sphere personal --focus "productividad y journaling"
```

Salida esperada:

- resumen fiel
- ideas clave
- relevancia para objetivos activos en `atenea`
- propuestas accionables
- claims a validar

Requisitos:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

### 3. `radar-os_youtube_pipeline`

Orquesta ambos pasos en secuencia.

Ejemplo:

```bash
npm run radar-os_youtube_pipeline -- --url "https://www.youtube.com/watch?v=YGof1CfY8IA" --sphere personal --focus "productividad y aprendizaje"
```

## Notas de diseño

- La transcripcion vive en `radar-os` como material bruto.
- El resumen generado en `proposals/` sigue siendo material interpretativo pendiente de validacion.
- La relevancia personal o profesional debe apoyarse en contexto real de `atenea`, no en memoria local de `radar-os`.
