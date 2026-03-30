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
  data/
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
- `radar-os_whisperkit_transcriber`
- `radar-os_transcript_backfill`
- `radar-os_video_summarizer`
- `radar-os_youtube_pipeline`
- `radar-os_atenea_ingestor`

### 1. `radar-os_youtube_transcriber`

Captura una transcripcion bruta, la guarda en `transcripts/`, la persiste en la BD local de `radar-os` y luego intenta generar el resumen interpretativo.

Ejemplo:

```bash
npm run radar-os_youtube_transcriber -- --url "https://www.youtube.com/watch?v=YGof1CfY8IA" --sphere personal --lang en
```

Comportamiento:

- intenta obtener captions del video cuando existan
- si no hay captions, falla y te empuja a usar `radar-os_whisperkit_transcriber`
- escribe un markdown con origen, metodo y transcripcion
- guarda el bruto tambien en `data/radar-os.sqlite`
- lanza automaticamente `radar-os_video_summarizer`
- si el resumen se genera, intenta enviarlo a `atenea` como material pendiente de validacion

### 2. `radar-os_video_summarizer`

Lee una transcripcion ya guardada, consulta contexto canónico en `atenea` y genera una propuesta de resumen local en `proposals/`.

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
- este output es el que puede enviarse a `atenea` para review, no el bruto

Requisitos:

- acceso local al repo y al contexto de `atenea`

Notas:

- usa `ollama` con el alias local `radar-os-qwen3.5-summary`
- ese alias se construye desde `qwen3.5:9b` con `num_ctx 8192`
- el prompt termina en `/nothink` para pedir respuesta directa sin razonamiento paso a paso
- si el modelo local no está disponible, usa un método local determinista y extractivo como fallback
- el resultado sigue siendo interpretativo y requiere validación humana

### 3. `radar-os_youtube_pipeline`

Orquesta el flujo completo:

- transcripcion
- persistencia local del bruto en `radar-os`
- resumen
- envio de la propuesta a `atenea` para review

Por defecto usa `WhisperKit` con el modelo turbo del proyecto.

Ejemplo:

```bash
npm run radar-os_youtube_pipeline -- --url "https://www.youtube.com/watch?v=YGof1CfY8IA" --sphere personal --focus "productividad y aprendizaje"
```

Ejemplo con pipeline local robusto:

```bash
npm run radar-os_youtube_pipeline -- --url "https://www.youtube.com/watch?v=YGof1CfY8IA" --sphere personal --transcriber whisperkit --lang en --focus "productividad y aprendizaje"
```

Si necesitas usar la via simple por captions, puedes forzar:

```bash
npm run radar-os_youtube_pipeline -- --url "https://www.youtube.com/watch?v=YGof1CfY8IA" --sphere personal --transcriber youtube --lang en --focus "productividad y aprendizaje"
```

### 4. `radar-os_whisperkit_transcriber`

Usa una cadena 100% local por CLI:

- `yt-dlp` para descargar audio
- `ffmpeg` para extracción cuando sea necesaria
- `whisperkit-cli` para transcribir en Apple Silicon

Ejemplo:

```bash
npm run radar-os_whisperkit_transcriber -- --url "https://www.youtube.com/watch?v=YGof1CfY8IA" --sphere personal --lang en --model large-v3-turbo
```

Ventajas:

- no depende de UI scripting
- es la via local por defecto del proyecto
- es automatizable y más estable
- modelo por defecto del proyecto: `large-v3-turbo`
- el script resuelve internamente `large-v3-turbo` a `whisper-large-v3-v20240930_turbo_632MB`, que es el identificador que entiende `whisperkit-cli`

### 5. `radar-os_transcript_backfill`

Reprocesa transcripciones ya existentes para aplicar el flujo actual:

- persistir el bruto en la BD local
- generar propuesta en `proposals/`
- enviar la propuesta a `atenea` para review si corresponde
- saltar automaticamente las transcripciones que ya tengan resumen y ya hayan sido reportadas a `atenea`
- si falla la red hacia `atenea`, dejar el estado como pendiente de reintento en la BD local

Ejemplos:

```bash
npm run radar-os_transcript_backfill -- --all
```

```bash
npm run radar-os_transcript_backfill -- --input transcripts/mi-transcript.md --focus "productividad y aprendizaje"
```

Si quieres forzar que tambien reconsidere casos ya completos:

```bash
npm run radar-os_transcript_backfill -- --all --include-completed true
```

### 6. `radar-os_atenea_ingestor`

Empuja materiales ya generados desde `radar-os` hacia `atenea`.

Casos soportados:

- transcript bruto hacia `/api/import/transcript`
- propuesta o resumen hacia `/api/raw`

Uso recomendado actualizado:

- conservar el transcript bruto dentro de `radar-os` y su BD local
- enviar a `atenea` sobre todo propuestas o resúmenes interpretativos
- hacer que esas propuestas entren pendientes de validacion antes de consolidar ideas

Ejemplos:

```bash
npm run radar-os_atenea_ingestor -- --input transcripts/mi-transcript.md --kind transcript --auto-process false
```

```bash
npm run radar-os_atenea_ingestor -- --input proposals/mi-resumen.md --kind proposal --auto-process true
```

Uso recomendado:

- transcript: usar solo si necesitas una ingestión explícita de evidencia bruta
- proposal: `auto-process true` para que entre a review en `atenea`

## Notas de diseño

- La transcripcion vive en `radar-os` como material bruto y tambien se persiste en la BD local `data/radar-os.sqlite`.
- El resumen generado en `proposals/` sigue siendo material interpretativo pendiente de validacion.
- El bruto no debe convertirse en ideas consolidadas sin pasar por review.
- La relevancia personal o profesional debe apoyarse en contexto real de `atenea`, no en memoria local de `radar-os`.
- Si un resumen generado quiere consolidarse como memoria, debe pasar por review humana en `atenea`.
- Terminologia recomendada:
- usar `script` para comandos invocados manualmente
- usar `worker` para piezas especializadas dentro de un pipeline
- reservar `agente` para componentes con autonomia real
