# Radar OS - instrucciones para Claude

Lee primero [SYSTEM_CONTEXT.md](/Users/raullopezgarcia/pka-v1/radar-os/SYSTEM_CONTEXT.md).

## Rol del repo

`radar-os` captura materiales y senales que alimentan a `atenea`.

No debe consolidar memoria interpretativa por su cuenta.

## Prioridades

1. Mantener el repositorio ligero y facil de usar como inbox de contenidos.
2. Preservar procedencia y contexto de los materiales.
3. Facilitar la ingestion hacia `atenea`.
4. Evitar crear estructuras o taxonomias excesivas antes de tiempo.

## Reglas

- no usar este repo como fuente final de verdad operativa
- no duplicar memoria validada
- no convertir interpretaciones en hechos sin review
- propagar a `atenea` cualquier cambio relevante de contrato o integracion

## Estructura minima esperada

- `transcripts/`
- `resources/`
- `notes/`
- `inbox/`
- `proposals/`

## Terminologia

En este repo:

- usar `scripts` para comandos invocados manualmente
- usar `workers` para piezas especializadas de un pipeline
- evitar llamar `agentes` a scripts, wrappers o pipelines simples

Solo hablar de `agentes` cuando exista autonomia real y ejecucion no manual.

## Scripts locales esperados

Si el trabajo implica videos o materiales audiovisuales, priorizar este flujo:

1. `radar-os_youtube_transcriber`
2. `radar-os_macwhisper_transcriber`
3. `radar-os_whisperkit_transcriber`
4. `radar-os_video_summarizer`
5. `radar-os_atenea_ingestor`

Comportamiento esperado:

- guardar la transcripcion en `transcripts/`
- guardar el resumen en `proposals/`
- usar `atenea` como fuente canónica para objetivos, tareas y memoria relevante
- enviar el material interpretativo a `atenea` para review antes de consolidarlo
- si en el futuro un componente gana autonomia real, actualizar estas instrucciones para reflejar el cambio de categoria
- si se usa `radar-os_whisperkit_transcriber`, preferir el modelo `whisper-large-v3-v20240930_turbo_632MB`
