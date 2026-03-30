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
2. `radar-os_whisperkit_transcriber` como via local por defecto usando el modelo turbo del proyecto
3. `radar-os_youtube_pipeline` para ejecutar transcripcion, persistencia local, resumen y envio a review
4. `radar-os_video_summarizer` para generar un resumen orientado a relevancia en `proposals/`
5. `radar-os_atenea_ingestor` para enviar la propuesta a `atenea` como material pendiente de validacion

Reglas:

- la transcripcion es evidencia bruta
- el bruto debe quedarse tambien en la BD local de `radar-os`
- el resumen sigue siendo interpretativo y requiere validacion
- la relevancia para objetivos del usuario debe apoyarse en contexto canónico de `atenea`
- no consolidar conclusiones finales dentro de `radar-os`
- preferir enviar a `atenea` el material interpretativo para review antes que el transcript bruto
- si en el futuro se crean componentes autonomos, documentar de forma separada que ya no son scripts sino agentes
- usar por defecto `large-v3-turbo`, resuelto internamente al identificador canónico de WhisperKit

## Criterio de calidad

Toda captura o clasificacion debe dejar claro:

- de donde viene
- por que puede ser relevante
- si requiere validacion
- que esfera o contexto le corresponde si aplica

## Uso de Ollama en agentes y scripts

- Considerar `ollama` solo para scripts, workers o agentes que ejecuten procesamiento local, concreto y acotado.
- En este repo aplica especialmente a clasificación, extracción, normalización, resumen, postproceso y transformación de materiales de entrada.
- Usarlo cuando ayude a reducir coste y tokens en Claude Code o Codex, evitando enviar bruto innecesario a modelos externos.
- No usarlo como modelo general por defecto del repo ni como sustituto del criterio de relevancia, review o gobierno del sistema.
- No delegar a `ollama` conclusiones finales, consolidación de memoria, cambios transversales ni tareas con alta ambigüedad.
- Todo uso de `ollama` debe producir salidas estructuradas, verificables y tratadas como material auxiliar o propuesta para revisión.
