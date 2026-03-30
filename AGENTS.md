# Radar OS - instrucciones canónicas

Lee primero [SYSTEM_CONTEXT.md](/Users/raullopezgarcia/pka-v1/radar-os/SYSTEM_CONTEXT.md) para entender el papel de este repo en ATENEA v1.

## Proposito

Este repositorio sirve como buzon de contenidos, senales y materiales de entrada para el sistema.

Su objetivo es capturar informacion util, no consolidarla como verdad final.

## Reglas permanentes

1. `radar-os` no es una base de memoria canónica.
2. Todo contenido interpretativo debe pasar por `atenea` antes de consolidarse.
3. No mezclar `work`, `personal` y `shared` sin necesidad explicita.
4. Mantener siempre trazabilidad de origen y tipo de material.
5. No registrar contenido sensible en logs o resúmenes innecesarios.
6. Si un cambio aqui afecta a contratos, API o gobierno del sistema, debe propagarse a `atenea` y al resto de repos afectados.

## Tipos de contenido esperados

- transcripciones
- recursos
- notas rapidas
- ideas
- materiales para review posterior

## Terminologia

En este repo:

- llamar `script` a cualquier comando invocado de forma directa
- llamar `worker` a piezas especializadas dentro de un flujo
- no llamar `agente` a scripts o pipelines simples

Solo usar `agente` si existe autonomia real, estado o memoria propia, capacidad de decidir pasos siguientes y ejecucion no manual.

## Flujo recomendado para videos

Cuando se procese un video de YouTube, usar este orden:

1. `radar-os_youtube_transcriber` para capturar la transcripcion bruta en `transcripts/`
2. `radar-os_macwhisper_transcriber` cuando se quiera una via local usando `MacWhisper`
3. `radar-os_whisperkit_transcriber` cuando se quiera una via local robusta por CLI
4. `radar-os_video_summarizer` para generar un resumen orientado a relevancia en `proposals/`
5. `radar-os_atenea_ingestor` para enviar el transcript o la propuesta a `atenea`

Reglas:

- la transcripcion es evidencia bruta
- el resumen sigue siendo interpretativo y requiere validacion
- la relevancia para objetivos del usuario debe apoyarse en contexto canónico de `atenea`
- no consolidar conclusiones finales dentro de `radar-os`
- si en el futuro se crean componentes autonomos, documentar de forma separada que ya no son scripts sino agentes
- si se usa `radar-os_whisperkit_transcriber`, preferir como modelo por defecto `whisper-large-v3-v20240930_turbo_632MB`

## Criterio de calidad

Toda captura o clasificacion debe dejar claro:

- de donde viene
- por que puede ser relevante
- si requiere validacion
- que esfera o contexto le corresponde si aplica
