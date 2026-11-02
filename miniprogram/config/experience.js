// Presentation profile only: never enables a cloud service or a trusted identity.
const EXPERIENCE_VERSION = '0.2.3.1026';
function isExperience(config) {
  return !!(
    config &&
    config.presentationProfile === 'experience' &&
    config.journalDemo === true &&
    config.cloudEnabled === false
  );
}
module.exports = { isExperience, EXPERIENCE_VERSION };
