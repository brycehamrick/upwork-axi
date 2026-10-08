/**
 * GraphQL documents extracted verbatim from the discovery run
 * (docs/discovery-20261008.md; run discover-20261008-122916-d40d).
 * Endpoint: https://www.upwork.com/api/graphql/v1 (cookie auth via the
 * browser session; headers sniffed in memory by appapi.ts).
 *
 * If a schema drift breaks one, re-run `upwork-axi discover`, re-extract,
 * and update this file plus the discovery doc. Never hand-write queries.
 */

/** Dashboard relations: open job postings + contracts (discovery exchange 48). */
export const CLIENT_DASHBOARD_RELATIONS = `
        query loadClientRelations(
          $teamId: ID!,
          $filter: ClientDashboardRelationFilter!,
          $sortOrder: ClientDashboardRelationSortOrder!
          $allowFilterFallback: Boolean
          $limit: Int
          $offset: Int
        ) {
          clientDashboardRelations(
            input: { teamId: $teamId, filter: $filter, sortOrder: $sortOrder, allowFilterFallback: $allowFilterFallback, limit: $limit, offset: $offset }
          ) {
            relations {
              opening {
                forUpdateId
                id
                title
                organizationId
                createdById
                createdByFirstName
                createdByLastName
                type
                status
                access
                ctime
                mtime
                categoryGroupName
                psm {
                  sourcerId
                  status
                }
                shortListedCount
                totalProposalsCount
                unreadProposalsCount
                hiredTalentsCount
                messagedCount
                invitationsCount
                freelancersToHire
                premium
                messagingInfo {
                  roomId
                  numberOfUnreadMessages
                }
                duration {
                  id
                }
                skills {
                  id
                }
                additionalSkills {
                  id
                }
                hourlyBudgetMin
                hourlyBudgetMax
                hourlyBudgetType
                amount
                openingExtra {
                  invitePost
                }
                annotations {
                  customFields {
                    jpgV2Prompt
                  }
                }
                qualifications {
                  locationCheckRequired
                  localMarket
                }
                groupId
                project {
                  id
                  title
                }
              }
              contractHourly {
                forUpdateId
                id
                rid
                title
                state
                startDateTime
                endedDate
                endedById
                hourlyRate
                weeklyLimit
                offerRid
                relationType
                manualTimeAllowed
                unpauseAllowed
                catalogProject
                totalCharge
                currentPauseStatus {
                  pauseDate
                }
                freelancer {
                  rid
                  id
                  photoUrl
                  firstName
                  lastName
                  isSuspended
                  cipherText
                }
                agency {
                  organizationId
                }
                company {
                  company {
                    id
                    rid
                  }
                  team {
                    rid
                  }
                }
                contractFeedback {
                  score
                  isFeedbackProvided
                  eligible
                  comment
                  response
                  submittedBy
                  readOnly
                }
                movedOutside
                feesPaidTime
                dispute {
                  recordId
                  status
                  resolvedAt
                  key
                  createdAt
                  resolution
                  counterpartyResponse
                }
                escrowRefundInfo {
                  escrowRefundStatus
                  createdAt
                }
                earnedThisWeek
                workedThisWeek
                lastUpdatedDateTime
                creationDateTime
                categoryId
                subcategoryId
                occupationId
                lastWorked {
                  date
                  memo
                  activityId
                  activityDescription
                }
                messagingInfo {
                  roomId
                  numberOfUnreadMessages
                  codeCleanseAvailable
                }
                project {
                  id
                  title
                }
                isUpwork2
              }
              contractFixed {
                forUpdateId
                id
                rid
                title
                state
                startDateTime
                endedDate
                endedById
                offerRid
                totalBudget
                isFp2
                isUpwork2
                catalogProject
                relationType
                totalCharge
                lastUpdatedDateTime
                activeMilestone {
                  rid
                  title
                  sequenceNumber
                  status
                  amountSubmitted
                  amountInEscrow
                  dueDateTime
                  freelancerSubmissionDate
                }
                catalogProjectOrder {
                  orderId
                  projectOrderStatus
                  deliveryDateTs
                  price
                  createdTs
                  scheduledEventId
                  scheduledEventStartDate
                  scheduledEventEndDate
                  projectId
                  donation
                  consultationType
                }
                freelancer {
                  rid
                  id
                  photoUrl
                  firstName
                  lastName
                  isSuspended
                  cipherText
                }
                agency {
                  organizationId
                }
                company {
                  company {
                    rid
                  }
                  team {
                    rid
                  }
                }
                contractFeedback {
                  score
                  isFeedbackProvided
                  eligible
                  comment
                  response
                  submittedBy
                  readOnly
                }
                movedOutside
                feesPaidTime
                dispute {
                  recordId
                  status
                  resolvedAt
                  key
                  createdAt
                  resolution
                  counterpartyResponse
                }
                escrowRefundInfo {
                  escrowRefundStatus
                  createdAt
                }
                milestoneProposalState
                creationDateTime
                categoryId
                subcategoryId
                occupationId
                messagingInfo {
                  roomId
                  numberOfUnreadMessages
                  codeCleanseAvailable
                }
                project {
                  id
                  title
                }
              }
              offerHourly {
                forUpdateId
                id
                rid
                title
                creationDateTime
                relationType
                freelancer {
                  id
                  photoUrl
                  firstName
                  lastName
                  cipherText
                }
                agency {
                  organizationId
                }
                lastUpdatedDateTime
                lastPublishedDateTime
                messagingInfo {
                  roomId
                  numberOfUnreadMessages
                }
                changeRequestId
                project {
                  id
                  title
                }
                isUpwork2
              }
              offerFixed {
                forUpdateId
                id
                rid
                title
                creationDateTime
                relationType
                freelancer {
                  id
                  photoUrl
                  firstName
                  lastName
                  cipherText
                }
                agency {
                  organizationId
                }
                lastUpdatedDateTime
                lastPublishedDateTime
                messagingInfo {
                  roomId
                  numberOfUnreadMessages
                }
                changeRequestId
                project {
                  id
                  title
                }
                isUpwork2
              }
              byoInvitation {
                forUpdateId
                id
                title
                creationDateTime
                inviteeEmail
                inviteeFirstName
                inviteeLastName
                sender {
                  id
                  photoUrl
                  firstName
                  lastName
                  cipherText
                }
                relationType
              }
              contractProposal {
                forUpdateId
                id
                title
                freelancer {
                  id
                  photoUrl
                  firstName
                  lastName
                  cipherText
                }
                relationType
                creationDateTime
              }
              draftOffer {
                id
                externalId
                meetingId
                forUpdateId
                title
                description
                proposedRate
                draftOfferStatus
                creationDateTime
                freelancerId
                contactPersonId
                relationType
                freelancer {
                  id
                  photoUrl
                  firstName
                  lastName
                  cipherText
                }
                contactPerson {
                  id
                  photoUrl
                  firstName
                  lastName
                  cipherText
                }
                messagingInfo {
                  roomId
                  numberOfUnreadMessages
                }
              }
            }
            filterTotalCounts {
              OPEN_OPENINGS
              ACTIVE_CONTRACTS
              DISPUTED_CONTRACTS
              PENDING_VERIFICATION_OPENINGS
              UPCOMING_CONTRACTS
              AWAITING_FEEDBACK
              DRAFT_OPENINGS
              PAUSED_CONTRACTS
              CONSULTATIONS
              PENDING_OFFERS
              PENDING_REFUND
              DRAFT_OFFERS
            }
            filter
            sortOrder
          }
        }
      `;

/** Proposals list for a job posting (discovery exchange 88). */
export const CLIENT_PROPOSALS_BY_FILTER = `
    query (
      $jobPostingId: ID!
      $statusFilter: ClientProposalStatusFilter!
      $pagination: Pagination
      $filter: ClientProposalFilterInput
      $sort: ClientProposalSortType
    ) {
      clientProposalsByFilter(
        jobPostingId: $jobPostingId
        statusFilter: $statusFilter
        pagination: $pagination
        sort: $sort
        filter: $filter
      ) {
        totalCount
        pageInfo {
          endCursor
          hasNextPage
        }
        edges {
          node {
            id
            status {
              status
              reason {
                reason
              }
            }
            job {
              id
            }
            offerId
            occupation {
              id
            }
            organization {
              id
              agencyProfile {
                id
                name
                logo
                earningAggregates {
                  totalCharge {
                    rawValue
                    currency
                  }
                }
              }
            }
            inviteToInterview {
              id
            }
            user {
              id
              rid
              name
              photoUrl
              ciphertext
              talentProfile {
                personalData {
                  title
                  location {
                    city
                    country
                    timezone
                  }
                }
                skills {
                  uid: id
                  prettyName
                }
                certificates {
                  certificate {
                    certificationUid: id
                    name
                    verifier
                    skillUIDs: skillNodes {
                      skillUid
                    }
                    skills
                  }
                }
                profileAggregates {
                  totalHours
                  nSS100BwScore
                  topRatedStatus
                  topRatedPlusStatus
                  totalRevenue
                  totalEarnings
                }
                preferences {
                  hideEarnings
                  hideJss
                }
                vetted
                responsivenessTags
              }
            }
            room {
              id
            }
            attachments {
              id
              link
              size: fileSize
              name: fileName
            }
            terms {
              chargeRate {
                rawValue
                currency
              }
              scheduledRateIncrease {
                percent
                frequency
              }
            }
            coverLetter
            projectPlan {
              milestones {
                description
                dueDate
                amount
              }
            }
            questionsAnswers {
              question
              answer
            }
            annotations
            referralInfo {
              referredFrom {
                vendorId
                inviteId
              }
            }
            gitHubRepoLink
            recommendationReason
            aiInterviewer {
                jobProposalId
                startTime
                badge
                status
                score
                stream {
                  thumbnail
                }
                summary {
                  text
                  sentiment
                  startTime
                }
              }
            partnerVerifiedTalent {
                verifiedTalent {
                  university
                  programUrl
                  completionDate
                  expiryDate
                  flId
                  skillIds
                  partnerId
                  categoryL1Id
                  vendorSkills
                  categoryL2Ids
                  trackName
                  status
                  certificationType
                  partnerVerified {
                    slug
                    name
                    description
                    url
                    logoUrl
                  }
                }
              }
          }
        }
      }
    }
  `;

/** One proposal detail (discovery exchange 388). */
export const CLIENT_PROPOSAL = `
query ClientProposal($id: ID!) {
  clientProposal(id: $id) {
    id
    coverLetter
    job {
      id
      contractTerms {
        hourlyContractTerms {
          hourlyBudgetMin
          hourlyBudgetMax
        }
        fixedPriceContractTerms {
          amount {
            displayValue
            rawValue
          }
        }
      }
    }
    terms {
      chargeRate {
        displayValue
        rawValue
      }
      scheduledRateIncrease {
        percent
        frequency
      }
    }
    attachments {
      link
      fileName
      fileSize
    }
  }
}
`;

/** Proposal pipeline counts for a job posting (discovery exchange 148). */
export const PROPOSALS_STATISTICS = `
  query ($jobPostingId: ID!) {
    proposalsStatistics(jobPostingId: $jobPostingId) {
      totalApplicants: totalProposals
      totalApplicantsWithAutoHidden
      totalAutoHidden
      totalShortlisted
      totalMessaged
      totalHired
      totalOffered
      totalArchived
      totalHidden
      totalDeclined
      totalWithdrawn
      totalPendingInvitations: totalInvitesSent
    }
  }
`;
