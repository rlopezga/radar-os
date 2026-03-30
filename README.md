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

## Scripts locales para video

Estos componentes son `scripts` especializados y un `pipeline` simple.

No deben llamarse `agentes` mientras no tengan autonomia real, estado propio, reintentos y capacidad de operar sin invocacion directa.

Se han dejado estos comandos base para procesar videos de YouTube dentro del rol de `radar-os`:

- `radar-os_youtube_transcriber`
- `radar-os_macwhisper_transcriber`
- `radar-os_whisperkit_transcriber`
- `radar-os_video_summarizer`
- `radar-os_youtube_pipeline`
- `radar-os_atenea_ingestor`

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

### 3. `radar-os_macwhisper_transcriber`

Usa `MacWhisper` en local mediante UI scripting para enviar una URL de YouTube al campo Home de la app y luego leer la transcripcion terminada desde su base de datos local.

Ejemplo:

```bash
npm run radar-os_macwhisper_transcriber -- --url "https://www.youtube.com/watch?v=YGof1CfY8IA" --sphere personal
```

Requisitos:

- `MacWhisper.app` instalado en `/Applications`
- permiso de Accesibilidad para Terminal o Codex

Notas:

- esta via evita OpenAI y funciona en local
- depende de automatizacion de UI, por lo que es mas fragil que una CLI nativa

### 4. `radar-os_youtube_pipeline`

Orquesta ambos pasos en secuencia.

Ejemplo:

```bash
npm run radar-os_youtube_pipeline -- --url "https://www.youtube.com/watch?v=YGof1CfY8IA" --sphere personal --focus "productividad y aprendizaje"
```

Ejemplo con `MacWhisper`:

```bash
npm run radar-os_youtube_pipeline -- --url "https://www.youtube.com/watch?v=YGof1CfY8IA" --sphere personal --transcriber macwhisper --focus "productividad y aprendizaje"
```

Ejemplo con pipeline local robusto:

```bash
npm run radar-os_youtube_pipeline -- --url "https://www.youtube.com/watch?v=YGof1CfY8IA" --sphere personal --transcriber whisperkit --lang en --focus "productividad y aprendizaje"
```

### 5. `radar-os_whisperkit_transcriber`

Usa una cadena 100% local por CLI:

- `yt-dlp` para descargar audio
- `ffmpeg` para extracción cuando sea necesaria
- `whisperkit-cli` para transcribir en Apple Silicon

Ejemplo:

```bash
npm run radar-os_whisperkit_transcriber -- --url "https://www.youtube.com/watch?v=YGof1CfY8IA" --sphere personal --lang en --model whisper-large-v3-v20240930_turbo_632MB
```

Ventajas:

- no depende de OpenAI
- no depende de UI scripting
- es automatizable y más estable
- modelo por defecto del proyecto: `whisper-large-v3-v20240930_turbo_632MB`

### 6. `radar-os_atenea_ingestor`

Empuja materiales ya generados desde `radar-os` hacia `atenea`.

Casos soportados:

- transcript bruto hacia `/api/import/transcript`
- propuesta o resumen hacia `/api/raw`

Ejemplos:

```bash
npm run radar-os_atenea_ingestor -- --input transcripts/mi-transcript.md --kind transcript --auto-process false
```

```bash
npm run radar-os_atenea_ingestor -- --input proposals/mi-resumen.md --kind proposal --auto-process true
```

Uso recomendado:

- transcript: `auto-process false`
- proposal: `auto-process true` para que entre a review en `atenea`

## Notas de diseño

- La transcripcion vive en `radar-os` como material bruto.
- El resumen generado en `proposals/` sigue siendo material interpretativo pendiente de validacion.
- La relevancia personal o profesional debe apoyarse en contexto real de `atenea`, no en memoria local de `radar-os`.
- Si un resumen generado quiere consolidarse como memoria, debe pasar por review humana en `atenea`.
- Terminologia recomendada:
- usar `script` para comandos invocados manualmente
- usar `worker` para piezas especializadas dentro de un pipeline
- reservar `agente` para componentes con autonomia real
