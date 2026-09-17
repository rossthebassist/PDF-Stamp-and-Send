(() => {
  const fallback = {
    customFieldIds: [4850614726431, 5112618319903, 4922801016095, 4845512973727, 5361731296927, 5014173804959],
    costCentreFieldId: 5361731296927,
    driverNameFieldId: 5014173804959,
    defaultStampSettings: { fontSize: 10, opacity: 0.85 }
  };
  const source = window.PDF_STAMP_CONFIG || {};
  const ids = Array.isArray(source.customFieldIds)
    ? source.customFieldIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  const fontSize = Number(source.defaultStampSettings?.fontSize);
  const opacity = Number(source.defaultStampSettings?.opacity);
  window.PDF_STAMP_CONFIG = Object.freeze({
    ...fallback,
    ...source,
    customFieldIds: ids.length ? ids : fallback.customFieldIds,
    costCentreFieldId: Number(source.costCentreFieldId) > 0 ? Number(source.costCentreFieldId) : fallback.costCentreFieldId,
    driverNameFieldId: Number(source.driverNameFieldId) > 0 ? Number(source.driverNameFieldId) : fallback.driverNameFieldId,
    defaultStampSettings: Object.freeze({
      fontSize: Number.isFinite(fontSize) && fontSize >= 6 && fontSize <= 20 ? fontSize : fallback.defaultStampSettings.fontSize,
      opacity: Number.isFinite(opacity) && opacity >= 0.1 && opacity <= 1 ? opacity : fallback.defaultStampSettings.opacity
    })
  });
})();
